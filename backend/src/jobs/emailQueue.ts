import { Queue } from 'bullmq'
import { redisConnection } from '../config/redis'
import { logger } from '../utils/logger'

/**
 * BullMQ Email Queue definition using persistent Redis storage.
 * Name: email-queue
 * Does NOT use any cron library. Uses BullMQ's built-in Redis timed delayed sets.
 */
export const EMAIL_QUEUE_NAME = 'email-queue'

export interface EmailJobData {
  emailId: string
  senderId?: string
  recipient: string
  subject: string
  html: string
  text?: string
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000, // 3s, 6s, 12s on failure retries
    },
    removeOnComplete: { count: 1000 }, // Keep historical record in Redis
    removeOnFail: { count: 1000 },
  },
})

emailQueue.on('error', (err) => {
  logger.error('BullMQ email-queue error:', err)
})

/**
 * Schedules a delayed email job with a deterministic job ID.
 * BullMQ delayed jobs survive backend and worker restarts in Redis.
 * If a job with this deterministic ID already exists, it is not recreated.
 */
export async function addDelayedEmailJob(
  data: EmailJobData,
  delayMs: number
): Promise<{ job: any; isNew: boolean }> {
  // Deterministic job ID based on PostgreSQL email record ID
  const deterministicJobId = `email-job-${data.emailId}`

  // Check if job already exists in BullMQ (prevent duplicate recreation)
  const existingJob = await emailQueue.getJob(deterministicJobId)
  if (existingJob) {
    logger.info(`Job ${deterministicJobId} already exists in BullMQ (state: ${await existingJob.getState()}). Skipping duplicate creation.`)
    return { job: existingJob, isNew: false }
  }

  // Calculate safe non-negative delay
  const safeDelay = Math.max(0, Math.floor(delayMs))

  logger.info(`Adding BullMQ delayed job ${deterministicJobId} for ${data.recipient} with delay: ${safeDelay}ms`)

  const job = await emailQueue.add('send-email', data, {
    delay: safeDelay,
    jobId: deterministicJobId,
  })

  return { job, isNew: true }
}
