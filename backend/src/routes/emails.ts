import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma'
import { addDelayedEmailJob, emailQueue } from '../jobs/emailQueue'
import { indexEmailDocument, searchEmailDocuments } from '../services/elasticsearchService'
import { logger } from '../utils/logger'
import { BadRequestError, NotFoundError } from '../utils/errors'

const router = Router()

// ── Validation Schemas ───────────────────────────────────────────
const scheduleBatchSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(255),
  body: z.string().min(1, 'Email body is required'),
  // Supports an array of email strings OR comma/newline-separated strings
  recipients: z.union([
    z.array(z.string().email('Invalid email address in recipients array')),
    z.string().min(1, 'Recipients required').transform((val) =>
      val
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    ),
  ]),
  senderId: z.string().uuid('Invalid Sender ID format').or(z.literal('')).optional().transform((v) => (v === '' ? undefined : v)),
  startTime: z.string().optional(), // ISO date/time string when the campaign should begin
  delayBetweenEmails: z.coerce.number().min(0).default(0), // In seconds between successive emails
  hourlyLimit: z.coerce.number().min(1).max(10000).optional(), // Maximum emails per hour
})

const createSingleEmailSchema = z.object({
  recipient: z.string().email(),
  subject: z.string().min(1).max(255),
  body: z.string().min(1),
  scheduledAt: z.string().datetime().optional(),
  senderId: z.string().uuid().or(z.literal('')).optional().transform((v) => (v === '' ? undefined : v)),
  idempotencyKey: z.string().optional(),
})

// ── POST /api/emails/schedule ────────────────────────────────────
/**
 * Main email scheduling endpoint using BullMQ and Redis.
 *
 * Flow:
 * 1. Validates subject, body, recipients, sender, and scheduling timings.
 * 2. Computes the spaced timeline based on delayBetweenEmails and hourlyLimit.
 * 3. Persists each email record into PostgreSQL with status 'scheduled'.
 * 4. Adds a delayed BullMQ job per email using a deterministic Job ID (email-job-<email.id>).
 * 5. Uses (scheduledAt - now) as the BullMQ delay; survives server and worker restarts in Redis.
 * 6. Never uses cron or node-cron.
 */
router.post('/schedule', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = scheduleBatchSchema.parse(req.body)

    // Ensure recipients list has at least one valid email
    const recipientsList = Array.isArray(data.recipients) ? data.recipients : [data.recipients]
    if (recipientsList.length === 0) {
      throw new BadRequestError('At least one recipient email address is required')
    }

    // Validate that every recipient in the parsed list is a valid email
    for (const r of recipientsList) {
      const emailTest = z.string().email().safeParse(r)
      if (!emailTest.success) {
        throw new BadRequestError(`Invalid recipient email address: "${r}"`)
      }
    }

    // Resolve authenticated user
    const user = req.user as any
    const userId = user?.id || (await getOrCreateDefaultUserId())

    // Validate sender if senderId is provided
    let senderId = data.senderId
    if (senderId) {
      const sender = await prisma.sender.findUnique({ where: { id: senderId } })
      if (!sender) {
        throw new NotFoundError(`Sender with ID ${senderId} not found`)
      }
      if (!sender.enabled) {
        throw new BadRequestError(`Sender ${sender.email} is currently disabled`)
      }
    } else {
      // Pick first enabled sender for this user if available
      const defaultSender = await prisma.sender.findFirst({
        where: { userId, enabled: true },
      })
      if (defaultSender) {
        senderId = defaultSender.id
      }
    }

    // ── Scheduling Timeline Calculation ──────────────────────────
    // Base starting time (defaults to immediately if not specified or in the past)
    const baseStartTimeMs = data.startTime ? new Date(data.startTime).getTime() : Date.now()
    const nowMs = Date.now()
    const initialDelayMs = Math.max(0, baseStartTimeMs - nowMs)

    // Interval between successive emails:
    // Factor in user-specified delay between emails + hourly limit throttling
    const delayStepMs = data.delayBetweenEmails * 1000 // Convert seconds to ms
    const hourlyLimitIntervalMs = data.hourlyLimit ? Math.floor(3600000 / data.hourlyLimit) : 0
    const stepIntervalMs = Math.max(delayStepMs, hourlyLimitIntervalMs)

    logger.info(
      `[Scheduler] Scheduling batch of ${recipientsList.length} emails. ` +
        `Base time: ${new Date(baseStartTimeMs).toISOString()}, Step interval: ${stepIntervalMs}ms`
    )

    const scheduledEmails = []

    // ── Process Each Email & Enqueue BullMQ Delayed Job ───────────
    for (let i = 0; i < recipientsList.length; i++) {
      const recipient = recipientsList[i]

      // Calculate scheduledAt for this specific recipient
      const emailTargetTimeMs = baseStartTimeMs + i * stepIntervalMs
      const scheduledAt = new Date(emailTargetTimeMs)
      const delayForThisEmail = Math.max(0, emailTargetTimeMs - Date.now())

      // 1. Save email in PostgreSQL database
      const email = await prisma.email.create({
        data: {
          userId,
          senderId,
          recipient,
          subject: data.subject,
          body: data.body,
          scheduledAt,
          status: 'scheduled',
        },
      })

      // 2. Add delayed BullMQ job with deterministic Job ID (email-job-<email.id>)
      // This guarantees idempotency and survives backend/worker restarts
      const { job } = await addDelayedEmailJob(
        {
          emailId: email.id,
          senderId,
          recipient: email.recipient,
          subject: email.subject,
          html: email.body,
        },
        delayForThisEmail
      )

      // 3. Link BullMQ job ID back to the PostgreSQL record
      const updatedEmail = await prisma.email.update({
        where: { id: email.id },
        data: { bullJobId: job.id },
      })

      scheduledEmails.push({
        id: updatedEmail.id,
        recipient: updatedEmail.recipient,
        subject: updatedEmail.subject,
        scheduledAt: updatedEmail.scheduledAt,
        status: updatedEmail.status,
        bullJobId: updatedEmail.bullJobId,
        delayMs: delayForThisEmail,
      })

      // 4. Non-blocking index into Elasticsearch (if active)
      // Fetch sender for indexing context, then call proper indexEmailDocument
      prisma.sender.findUnique({ where: { id: senderId || '' } })
        .then((sender) => indexEmailDocument({ ...email, sender: sender ? { email: sender.email, name: sender.name } : null }))
        .catch((err) => logger.warn('Elasticsearch indexing failed (non-critical):', err.message))
    }

    res.status(201).json({
      success: true,
      message: `Successfully scheduled ${scheduledEmails.length} email(s)`,
      count: scheduledEmails.length,
      startTime: new Date(baseStartTimeMs).toISOString(),
      delayBetweenEmails: data.delayBetweenEmails,
      hourlyLimit: data.hourlyLimit || null,
      emails: scheduledEmails,
    })
  } catch (error) {
    next(error)
  }
})

// ── POST /api/emails (Single Immediate or Delayed Email) ──────────
router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createSingleEmailSchema.parse(req.body)
    const user = req.user as any
    const userId = user?.id || (await getOrCreateDefaultUserId())

    const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : new Date()
    const delay = Math.max(0, scheduledAt.getTime() - Date.now())

    // Check idempotencyKey if provided
    if (data.idempotencyKey) {
      const existing = await prisma.email.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      })
      if (existing) {
        res.status(200).json(existing)
        return
      }
    }

    // 1. Create in PostgreSQL
    const email = await prisma.email.create({
      data: {
        userId,
        senderId: data.senderId,
        recipient: data.recipient,
        subject: data.subject,
        body: data.body,
        scheduledAt,
        status: 'scheduled',
        idempotencyKey: data.idempotencyKey,
      },
    })

    // 2. Add delayed BullMQ job with deterministic Job ID
    const { job } = await addDelayedEmailJob(
      {
        emailId: email.id,
        senderId: email.senderId || undefined,
        recipient: email.recipient,
        subject: email.subject,
        html: email.body,
      },
      delay
    )

    // 3. Record job ID
    const updated = await prisma.email.update({
      where: { id: email.id },
      data: { bullJobId: job.id },
    })

    res.status(201).json(updated)
  } catch (error) {
    next(error)
  }
})

// ── GET /api/emails (List all emails - paginated, scoped to authenticated user) ──────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = Number(req.query.page ?? 1)
    const limit = Number(req.query.limit ?? 20)
    const skip = (page - 1) * limit
    const status = req.query.status as any
    const user = req.user as any
    const userId = user?.id

    // Scope by authenticated user; if no user (fallback), show all
    const where: any = userId ? { userId } : {}
    if (status) where.status = status

    const [emails, total] = await Promise.all([
      prisma.email.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      prisma.email.count({ where }),
    ])

    res.json({
      success: true,
      data: emails,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    next(error)
  }
})

// ── GET /api/emails/search (Elasticsearch full-text search with DB fallback) ────────
router.get('/search', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = String(req.query.q ?? '').trim()
    const status = req.query.status as 'scheduled' | 'processing' | 'sent' | 'failed' | 'all' | undefined
    const page = Number(req.query.page ?? 1)
    const limit = Number(req.query.limit ?? 20)
    const user = req.user as any
    const userId = user?.id

    const result = await searchEmailDocuments({ query: q, status, page, limit, userId })
    res.json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
})

// ── GET /api/emails/:id (Get single email) ─────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id)
    const email = await prisma.email.findUnique({
      where: { id },
      include: { sender: true, user: true },
    })
    if (!email) {
      throw new NotFoundError(`Email with ID ${id} not found`)
    }
    res.json({ success: true, email })
  } catch (error) {
    next(error)
  }
})

// ── DELETE /api/emails/:id (Cancel a scheduled email) ─────────────
router.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id)
    const email = await prisma.email.findUnique({ where: { id } })
    if (!email) {
      throw new NotFoundError(`Email with ID ${id} not found`)
    }
    if (email.status !== 'scheduled') {
      throw new BadRequestError(`Only scheduled emails can be cancelled. Current status: ${email.status}`)
    }

    // If job is in BullMQ queue, remove it
    if (email.bullJobId) {
      const job = await emailQueue.getJob(email.bullJobId)
      if (job) {
        await job.remove().catch((e) => logger.warn(`Failed to remove job ${email.bullJobId} from BullMQ:`, e))
      }
    }

    const cancelledEmail = await prisma.email.update({
      where: { id },
      data: { status: 'failed', errorMessage: 'Cancelled by user' },
    })

    res.json({
      success: true,
      message: 'Scheduled email cancelled successfully',
      email: cancelledEmail,
    })
  } catch (error) {
    next(error)
  }
})

// Fallback helper for default admin user
async function getOrCreateDefaultUserId(): Promise<string> {
  let user = await prisma.user.findFirst()
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'ReachInbox Admin',
        email: 'admin@reachinbox.example.com',
      },
    })
  }
  return user.id
}

export default router
