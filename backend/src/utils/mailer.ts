import nodemailer from 'nodemailer'
import { env } from '../config/env'
import { logger } from './logger'
import { sendEmailWithSender } from '../services/emailService'

export const mailer = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  auth: {
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },
})

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
  senderId?: string
}

export async function sendEmail(options: SendEmailOptions) {
  return sendEmailWithSender({
    senderId: options.senderId,
    recipient: options.to,
    subject: options.subject,
    body: options.html,
    text: options.text,
  })
}
