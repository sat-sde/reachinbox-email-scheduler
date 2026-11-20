import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma'
import { registerSender, sendEmailWithSender } from '../services/emailService'
import { NotFoundError } from '../utils/errors'
import { logger } from '../utils/logger'

const router = Router()

const createSenderSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Valid email required'),
  etherealUser: z.string().optional(),
  etherealPass: z.string().optional(),
  host: z.string().optional(),
  port: z.coerce.number().optional(),
  hourlyLimit: z.coerce.number().min(1).max(10000).optional(),
})

const testEmailSchema = z.object({
  recipient: z.string().email('Valid recipient email required').optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
})

// ── POST /api/senders (Create/Register a new Sender) ───────────────
router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createSenderSchema.parse(req.body)
    const user = req.user as any
    const userId = user?.id || (await getOrCreateDefaultUserId())

    const sender = await registerSender({
      userId,
      name: data.name,
      email: data.email,
      host: data.host,
      port: data.port,
      hourlyLimit: data.hourlyLimit,
      etherealUser: data.etherealUser,
      etherealPass: data.etherealPass,
    })

    logger.info(`Registered new sender: ${sender.email} (${sender.id}) for user ${userId}`)
    res.status(201).json({
      success: true,
      message: 'Sender registered successfully',
      sender,
    })
  } catch (error) {
    next(error)
  }
})

// ── GET /api/senders (List Senders) ───────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as any
    const userId = user?.id

    const senders = await prisma.sender.findMany({
      where: userId ? { userId } : {},
      select: {
        id: true,
        userId: true,
        name: true,
        email: true,
        host: true,
        port: true,
        hourlyLimit: true,
        enabled: true,
        createdAt: true,
        _count: {
          select: { emails: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json({
      success: true,
      data: senders,
      count: senders.length,
    })
  } catch (error) {
    next(error)
  }
})

// ── GET /api/senders/:id (Get single Sender) ──────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id)
    const sender = await prisma.sender.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        name: true,
        email: true,
        host: true,
        port: true,
        hourlyLimit: true,
        enabled: true,
        createdAt: true,
        _count: {
          select: { emails: true },
        },
      },
    })

    if (!sender) {
      throw new NotFoundError(`Sender with ID ${id} not found`)
    }

    res.json({
      success: true,
      sender,
    })
  } catch (error) {
    next(error)
  }
})

// ── DELETE /api/senders/:id (Delete a Sender) ─────────────────────
router.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id)
    const sender = await prisma.sender.findUnique({
      where: { id },
    })

    if (!sender) {
      throw new NotFoundError(`Sender with ID ${id} not found`)
    }

    await prisma.sender.delete({
      where: { id },
    })

    logger.info(`Deleted sender: ${sender.email} (${id})`)
    res.json({
      success: true,
      message: 'Sender deleted successfully',
      deletedId: id,
    })
  } catch (error) {
    next(error)
  }
})

// ── POST /api/senders/:id/test (Send a test email using this sender)
router.post('/:id/test', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id)
    const data = testEmailSchema.parse(req.body)
    const user = req.user as any
    const recipient = data.recipient || 'recipient@reachinbox.example.com'
    const subject = data.subject || 'ReachInbox Ethereal Test Email'
    const body =
      data.body ||
      `
      <div style="font-family: sans-serif; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 500px;">
        <h2 style="color: #2563eb; margin-top: 0;">ReachInbox Test Email</h2>
        <p>This is a real test email delivered via <strong>Ethereal Email SMTP</strong>.</p>
        <p>Sender ID: <code>${id}</code></p>
        <p style="color: #64748b; font-size: 13px;">Timestamp: ${new Date().toISOString()}</p>
      </div>
      `

    const result = await sendEmailWithSender({
      senderId: id,
      userId: user?.id,
      recipient,
      subject,
      body,
    })

    res.json({
      success: true,
      message: 'Test email sent successfully via Ethereal SMTP',
      previewUrl: result.previewUrl,
      messageId: result.messageId,
      response: result.response,
    })
  } catch (error) {
    next(error)
  }
})

// Helper fallback for tests or seeds
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
