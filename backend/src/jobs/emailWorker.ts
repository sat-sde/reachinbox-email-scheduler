import { Worker, Job, DelayedError } from 'bullmq'
import { redisConnection } from '../config/redis'
import { EMAIL_QUEUE_NAME, EmailJobData } from './emailQueue'
import { sendEmailWithSender } from '../services/emailService'
import { reserveSenderSlot, releaseSenderSlot } from '../services/rateLimiterService'
import { sendSlackRateLimitNotification } from '../services/slackService'
import { prisma } from '../config/prisma'
import { logger } from '../utils/logger'
import { env } from '../config/env'

/**
 * Production-style BullMQ Email Worker with Distributed Rate Limiting & Concurrency Control.
 *
 * Rate Limiting Flow:
 * 1. Concurrency bounded by WORKER_CONCURRENCY environment variable.
 * 2. For each job, atomically queries Redis via Lua script to check:
 *    a) Hourly sending limit for the specific sender.
 *    b) Minimum delay since the sender's last dispatch (MIN_DELAY_BETWEEN_EMAILS_MS).
 * 3. If rate limit is exceeded:
 *    - Job is NOT dropped.
 *    - Job is NOT failed.
 *    - Calculates the exact millisecond when the next slot opens.
 *    - Reschedules the job in BullMQ using native Redis delayed sets (moveToDelayed).
 *    - Preserves PostgreSQL status as 'scheduled' and updates scheduledAt.
 * 4. If slot is acquired:
 *    - Dispatches email through Ethereal SMTP.
 *    - Captures preview URL & messageId, sets PostgreSQL status to 'sent'.
 *    - If unrecoverable pre-SMTP failure occurs, releases reserved slot in Redis.
 */
export function createEmailWorker(customConcurrency?: number): Worker<EmailJobData> {
  const concurrency = customConcurrency ?? env.WORKER_CONCURRENCY

  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>, token?: string) => {
      const { emailId, senderId, recipient, subject, html, text } = job.data
      const effectiveSenderId = senderId || 'default-global-sender'

      logger.info(`[Worker] Received job ${job.id} (email: ${emailId}, recipient: ${recipient})`)

      // ── Step 1: Database State Verification ─────────────────────
      // Avoid duplicate sends if job was retried or already completed
      const existingEmail = await prisma.email.findUnique({
        where: { id: emailId },
        include: { sender: true },
      })

      if (!existingEmail) {
        logger.warn(`[Worker] Email ${emailId} no longer exists in database. Aborting job ${job.id}.`)
        return
      }

      if (existingEmail.status === 'sent') {
        logger.info(`[Worker] Email ${emailId} was already sent at ${existingEmail.sentAt}. Skipping duplicate dispatch.`)
        return
      }

      // ── Step 2: Resolve Sender Rate Limits ──────────────────────
      let maxHourlyLimit = env.MAX_EMAILS_PER_HOUR_PER_SENDER
      if (senderId) {
        const sender = await prisma.sender.findUnique({ where: { id: senderId } })
        if (sender?.hourlyLimit) {
          maxHourlyLimit = sender.hourlyLimit
        }
      }

      // ── Step 3: Atomic Redis Rate Limit Reservation ─────────────
      // Evaluates hourly limit and minDelay atomically using Redis Lua script
      const reservation = await reserveSenderSlot({
        senderId: effectiveSenderId,
        emailId,
        maxHourlyLimit,
        minDelayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      })

      // If sender reached limit or minDelay constraint is active
      if (!reservation.allowed) {
        const delayNeeded = reservation.delayNeededMs
        const nextAttemptTime = reservation.nextAvailableTime || new Date(Date.now() + delayNeeded)

        logger.info(
          `[Worker] ⏳ Rate limiter active for sender ${effectiveSenderId} (${reservation.reason}). ` +
            `Current count: ${reservation.currentCount}/${maxHourlyLimit}. ` +
            `Rescheduling email ${emailId} for +${delayNeeded}ms (at ${nextAttemptTime.toISOString()}).`
        )

        // ── Step 3b: Trigger Slack Notification on Hourly Limit Exceeded ──
        if (reservation.reason === 'HOURLY_LIMIT_EXCEEDED' && senderId) {
          sendSlackRateLimitNotification({
            senderId,
            senderEmail: existingEmail.sender?.email || 'Unknown Sender',
            hourlyLimit: maxHourlyLimit,
            nextAvailableTime: nextAttemptTime,
            delayNeededMs: delayNeeded,
            userId: existingEmail.userId,
          }).catch((err) => {
            logger.warn('[Worker] Non-critical error sending Slack rate-limit alert:', err)
          })
        }

        // Preserve email record in PostgreSQL: keep status 'scheduled' and update target time
        await prisma.email.update({
          where: { id: emailId },
          data: {
            status: 'scheduled',
            scheduledAt: nextAttemptTime,
          },
        }).catch((err) => logger.warn('[Worker] Failed to update scheduledAt in DB:', err))

        // Move job into BullMQ delayed set in Redis
        if (token) {
          await job.moveToDelayed(Date.now() + delayNeeded, token)
          // Throw DelayedError to gracefully transition without marking job as failed
          throw new DelayedError()
        } else {
          logger.warn(`[Worker] No lock token found for job ${job.id}. Skipping.`)
          return
        }
      }

      // ── Step 4: Slot Reserved! Dispatch Email ──────────────────
      logger.info(`[Worker] Slot reserved for sender ${effectiveSenderId} (${reservation.currentCount}/${maxHourlyLimit}). Dispatching...`)

      // Mark status as 'processing' in PostgreSQL
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'processing',
          bullJobId: job.id,
        },
      })

      try {
        // Deliver through Ethereal SMTP service
        const result = await sendEmailWithSender({
          emailId,
          senderId,
          recipient,
          subject,
          body: html,
          text,
        })

        logger.info(`[Worker] ✅ Email ${emailId} successfully delivered! Message-ID: ${result.messageId}`)
        if (result.previewUrl) {
          logger.info(`[Worker] 🔗 Ethereal Preview URL: ${result.previewUrl}`)
        }
      } catch (sendError: any) {
        // Release the reserved slot in Redis so network/SMTP errors don't exhaust quota
        await releaseSenderSlot(effectiveSenderId, emailId)
        throw sendError
      }
    },
    {
      connection: redisConnection,
      concurrency, // Configurable worker concurrency across instances
    }
  )

  // ── Event Listeners ────────────────────────────────────────────
  worker.on('completed', (job) => {
    logger.info(`[Worker] Job ${job.id} completed successfully`)
  })

  worker.on('failed', async (job, err) => {
    // If it's a DelayedError, it's a scheduled rate-limit pause, not a real failure
    if (err instanceof DelayedError || err?.name === 'DelayedError') {
      return
    }

    if (!job) return
    logger.error(`[Worker] Job ${job.id} failed: ${err.message}`)

    const maxAttempts = job.opts.attempts ?? 3
    if (job.attemptsMade >= maxAttempts) {
      logger.warn(`[Worker] Job ${job.id} reached max retry attempts (${maxAttempts}). Marking email as failed in database.`)
      await prisma.email.update({
        where: { id: job.data.emailId },
        data: {
          status: 'failed',
          errorMessage: err.message || 'SMTP delivery exceeded max retry attempts',
        },
      }).catch((dbErr) => logger.error('[Worker] Failed to update email failure status:', dbErr))
    }
  })

  worker.on('error', (err) => {
    logger.error('[Worker] Worker encountered system error:', err)
  })

  return worker
}
