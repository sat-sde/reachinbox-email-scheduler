import nodemailer, { Transporter } from 'nodemailer'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { decrypt, encrypt } from '../utils/crypto'
import { logger } from '../utils/logger'
import { NotFoundError, BadRequestError } from '../utils/errors'

export interface SendMailOptions {
  senderId?: string
  recipient: string
  subject: string
  body: string
  text?: string
  emailId?: string
  userId?: string
}

export interface SendMailResult {
  success: boolean
  messageId: string
  previewUrl: string | false
  response: string
  senderEmail: string
  emailId?: string
}

/**
 * Creates a Nodemailer transporter using specific Ethereal SMTP credentials
 */
export function createSenderTransporter(options: {
  host?: string
  port?: number
  user: string
  pass: string
}): Transporter {
  return nodemailer.createTransport({
    host: options.host || 'smtp.ethereal.email',
    port: options.port || 587,
    secure: false, // Ethereal uses STARTTLS on 587
    auth: {
      user: options.user,
      pass: options.pass,
    },
  })
}

/**
 * Generates a brand new disposable Ethereal test account
 */
export async function createEtherealAccount(): Promise<{
  user: string
  pass: string
  smtp: { host: string; port: number; secure: boolean }
  web: string
}> {
  logger.info('Generating new Ethereal test account via Nodemailer...')
  const testAccount = await nodemailer.createTestAccount()
  logger.info(`Generated Ethereal account: ${testAccount.user}`)
  return testAccount
}

/**
 * Sends an email using a configured Sender (or default Ethereal credentials)
 * Captures the SMTP response, preview URL, and saves delivery results in PostgreSQL.
 */
export async function sendEmailWithSender(options: SendMailOptions): Promise<SendMailResult> {
  const { senderId, recipient, subject, body, text, emailId, userId } = options

  let senderEmail = env.SMTP_FROM
  let senderName = 'ReachInbox Scheduler'
  let transporter: Transporter

  // 1. Resolve Sender
  if (senderId) {
    const sender = await prisma.sender.findUnique({
      where: { id: senderId },
    })

    if (!sender) {
      throw new NotFoundError(`Sender with ID ${senderId} not found`)
    }

    if (!sender.enabled) {
      throw new BadRequestError(`Sender ${sender.email} is currently disabled`)
    }

    senderEmail = sender.email
    senderName = sender.name

    const decryptedUser = decrypt(sender.etherealUser)
    const decryptedPass = decrypt(sender.etherealPass)

    transporter = createSenderTransporter({
      host: sender.host,
      port: sender.port,
      user: decryptedUser,
      pass: decryptedPass,
    })
  } else {
    // Fall back to environment SMTP or generate on-demand test account
    let user = env.SMTP_USER
    let pass = env.SMTP_PASS

    if (!user || !pass) {
      logger.info('No SMTP credentials in env, generating dynamic Ethereal test account...')
      const autoAccount = await createEtherealAccount()
      user = autoAccount.user
      pass = autoAccount.pass
      senderEmail = autoAccount.user
    }

    transporter = createSenderTransporter({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user,
      pass,
    })
  }

  // 2. Dispatch Email through Nodemailer SMTP
  try {
    logger.info(`Sending email to ${recipient} via sender ${senderEmail}...`)

    const info = await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: recipient,
      subject,
      html: body,
      text: text || body.replace(/<[^>]*>?/gm, ''), // Stripped text version
    })

    const previewUrl = nodemailer.getTestMessageUrl(info)
    const messageId = info.messageId

    logger.info(`✅ SMTP Delivery Success! Message-ID: ${messageId}`)
    if (previewUrl) {
      logger.info(`🔗 Ethereal Email Preview URL: ${previewUrl}`)
    }

    // 3. Update or create PostgreSQL record with delivery result
    if (emailId) {
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          messageId,
          previewUrl: previewUrl || null,
          errorMessage: null,
          ...(senderId ? { senderId } : {}),
        },
      })
    } else if (userId) {
      await prisma.email.create({
        data: {
          userId,
          senderId,
          recipient,
          subject,
          body,
          scheduledAt: new Date(),
          sentAt: new Date(),
          status: 'sent',
          messageId,
          previewUrl: previewUrl || null,
        },
      })
    }

    return {
      success: true,
      messageId,
      previewUrl,
      response: info.response,
      senderEmail,
      emailId,
    }
  } catch (error: any) {
    logger.error(`❌ SMTP Delivery Failed for ${recipient}:`, error)

    // Record failure in PostgreSQL
    if (emailId) {
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'failed',
          errorMessage: error.message || 'SMTP delivery failure',
        },
      }).catch((dbErr) => logger.error('Failed to update email status in DB:', dbErr))
    }

    throw error
  }
}

/**
 * Creates or registers a Sender in PostgreSQL with encrypted credentials
 */
export async function registerSender(data: {
  userId: string
  name: string
  email: string
  host?: string
  port?: number
  hourlyLimit?: number
  etherealUser?: string
  etherealPass?: string
}) {
  let etherealUser = data.etherealUser
  let etherealPass = data.etherealPass
  let host = data.host || 'smtp.ethereal.email'
  let port = data.port || 587

  // If no credentials supplied, automatically create a real Ethereal account!
  if (!etherealUser || !etherealPass) {
    const etherealAccount = await createEtherealAccount()
    etherealUser = etherealAccount.user
    etherealPass = etherealAccount.pass
    host = etherealAccount.smtp.host
    port = etherealAccount.smtp.port
  }

  // Encrypt the sensitive Ethereal credentials
  const encryptedUser = encrypt(etherealUser)
  const encryptedPass = encrypt(etherealPass)

  const sender = await prisma.sender.create({
    data: {
      userId: data.userId,
      name: data.name,
      email: data.email || etherealUser,
      host,
      port,
      etherealUser: encryptedUser,
      etherealPass: encryptedPass,
      hourlyLimit: data.hourlyLimit || 50,
      enabled: true,
    },
  })

  // Return sender without exposed password
  return {
    id: sender.id,
    userId: sender.userId,
    name: sender.name,
    email: sender.email,
    host: sender.host,
    port: sender.port,
    hourlyLimit: sender.hourlyLimit,
    enabled: sender.enabled,
    createdAt: sender.createdAt,
  }
}

