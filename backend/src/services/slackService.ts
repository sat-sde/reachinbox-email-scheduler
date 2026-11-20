import axios from 'axios'
import jwt from 'jsonwebtoken'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { encrypt, decrypt } from '../utils/crypto'
import { logger } from '../utils/logger'
import { redisConnection } from '../config/redis'

export interface SlackOAuthResult {
  success: boolean
  error?: string
  connection?: {
    id: string
    teamId: string
    teamName: string | null
    channelName: string | null
    connectedAt: Date
  }
}

export interface SlackNotificationParams {
  senderId: string
  senderEmail: string
  hourlyLimit: number
  nextAvailableTime: Date
  delayNeededMs: number
  userId?: string
}

export interface SlackNotificationResult {
  sent: boolean
  reason?: 'NOT_CONNECTED' | 'ALREADY_NOTIFIED' | 'SUCCESS' | 'ERROR'
  ts?: string
  error?: string
}

/**
 * Minimum required Slack permissions:
 * - 'chat:write': Enables the bot to send messages via Slack Web API chat.postMessage
 * - 'incoming-webhook': Prompts the user during OAuth to select the designated target channel
 */
export const SLACK_REQUIRED_SCOPES = 'chat:write,incoming-webhook'

/**
 * 1. Generates the official Slack OAuth v2 authorization redirect URL
 */
export function getSlackAuthUrl(userId: string): { url: string; configured: boolean; message?: string } {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    return {
      url: '',
      configured: false,
      message: 'Slack OAuth is not configured on the server. Please check SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in backend/.env',
    }
  }

  // Sign a secure state token containing the authenticated userId (expires in 15 mins)
  const state = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '15m' })

  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: SLACK_REQUIRED_SCOPES,
    redirect_uri: env.SLACK_CALLBACK_URL,
    state,
  })

  return {
    url: `https://slack.com/oauth/v2/authorize?${params.toString()}`,
    configured: true,
  }
}

/**
 * 2. Exchanges temporary OAuth authorization code for permanent bot access token
 */
export async function exchangeSlackCode(code: string, state: string): Promise<SlackOAuthResult> {
  // Validate state token and extract userId
  let userId: string
  try {
    const decoded = jwt.verify(state, env.JWT_SECRET) as { userId: string }
    userId = decoded.userId
  } catch (err: any) {
    logger.error('Slack OAuth state validation failed:', err.message)
    return { success: false, error: 'Invalid or expired OAuth state parameter' }
  }

  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    return { success: false, error: 'Slack OAuth credentials missing on backend' }
  }

  try {
    // Request access token from Slack Web API
    const response = await axios.post(
      'https://slack.com/api/oauth.v2.access',
      new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: env.SLACK_CALLBACK_URL,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      }
    )

    const data = response.data
    if (!data.ok) {
      logger.error('Slack OAuth exchange rejected by Slack:', data)
      return { success: false, error: data.error || 'Slack OAuth authorization failed' }
    }

    const accessToken = data.access_token
    if (!accessToken) {
      return { success: false, error: 'No access token received from Slack' }
    }

    const teamId = data.team?.id || ''
    const teamName = data.team?.name || null
    const channelId = data.incoming_webhook?.channel_id || data.authed_user?.id || null
    const channelName = data.incoming_webhook?.channel || null
    const slackUserId = data.authed_user?.id || null
    const botUserId = data.bot_user_id || null

    // Securely encrypt the Slack access token before persisting in PostgreSQL
    const encryptedToken = encrypt(accessToken)

    // Save or update Slack connection in PostgreSQL
    const existing = await prisma.slackConnection.findFirst({
      where: { userId },
    })

    let connection
    if (existing) {
      connection = await prisma.slackConnection.update({
        where: { id: existing.id },
        data: {
          accessToken: encryptedToken,
          teamId,
          teamName,
          channelId,
          channelName,
          slackUserId,
          botUserId,
          connected: true,
        },
      })
      logger.info(`Updated existing Slack connection for user ${userId} (Team: ${teamName || teamId})`)
    } else {
      connection = await prisma.slackConnection.create({
        data: {
          userId,
          accessToken: encryptedToken,
          teamId,
          teamName,
          channelId,
          channelName,
          slackUserId,
          botUserId,
          connected: true,
        },
      })
      logger.info(`Created new Slack connection for user ${userId} (Team: ${teamName || teamId})`)
    }

    return {
      success: true,
      connection: {
        id: connection.id,
        teamId: connection.teamId,
        teamName: connection.teamName,
        channelName: connection.channelName,
        connectedAt: connection.createdAt,
      },
    }
  } catch (error: any) {
    logger.error('Error exchanging Slack OAuth code:', error.message)
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Network error during Slack OAuth exchange',
    }
  }
}

/**
 * 3. Retrieves the current user's Slack connection status
 */
export async function getSlackConnectionStatus(userId: string): Promise<{
  connected: boolean
  connection: {
    id: string
    teamId: string
    teamName: string | null
    channelName: string | null
    channelId: string | null
    connectedAt: Date
  } | null
}> {
  const connection = await prisma.slackConnection.findFirst({
    where: { userId, connected: true },
    orderBy: { updatedAt: 'desc' },
  })

  if (!connection) {
    return { connected: false, connection: null }
  }

  return {
    connected: true,
    connection: {
      id: connection.id,
      teamId: connection.teamId,
      teamName: connection.teamName,
      channelName: connection.channelName,
      channelId: connection.channelId,
      connectedAt: connection.createdAt,
    },
  }
}

/**
 * 4. Disconnects Slack integration for a user
 */
export async function disconnectSlackConnection(userId: string): Promise<boolean> {
  await prisma.slackConnection.updateMany({
    where: { userId },
    data: { connected: false },
  })
  logger.info(`Disconnected Slack for user ${userId}`)
  return true
}

/**
 * 5. Dispatches real Slack message via chat.postMessage when sender reaches hourly limit.
 *
 * Requirements:
 * - Real Slack Web API chat.postMessage
 * - Includes sender email, hourly limit, and next available sending time
 * - Notifies ONLY ONCE per sender per hourly limit event
 * - Stores notification state in Redis to avoid duplicate spam
 * - If Slack is not connected, continues scheduling normally without crashing
 * - If Slack is connected later, future notifications work without redeployment
 */
export async function sendSlackRateLimitNotification(
  params: SlackNotificationParams
): Promise<SlackNotificationResult> {
  const { senderId, senderEmail, hourlyLimit, nextAvailableTime, delayNeededMs } = params

  try {
    // ── A. Redis Deduplication ─────────────────────────────────────
    // Deduplication Key: senderId + timestamp of the next window
    const eventWindowKey = `slack:rate_limit_alert:${senderId}:${nextAvailableTime.getTime()}`
    // TTL: time remaining until window opens + 30s buffer (minimum 60 seconds)
    const ttlSeconds = Math.max(60, Math.ceil((nextAvailableTime.getTime() - Date.now()) / 1000) + 30)

    // Atomically set key ONLY IF NOT EXISTS (NX)
    const acquired = await redisConnection.set(eventWindowKey, '1', 'EX', ttlSeconds, 'NX')
    if (!acquired) {
      logger.info(
        `[Slack] Rate limit alert already dispatched for sender ${senderEmail} (event window ending ${nextAvailableTime.toISOString()}). Skipping duplicate.`
      )
      return { sent: false, reason: 'ALREADY_NOTIFIED' }
    }

    // ── B. Find Active Slack Connection ───────────────────────────
    // 1. Check if the sender's user has connected Slack
    let connection = null
    if (senderId) {
      const sender = await prisma.sender.findUnique({
        where: { id: senderId },
        include: {
          user: {
            include: {
              slackConnections: {
                where: { connected: true },
                orderBy: { updatedAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      })
      connection = sender?.user?.slackConnections?.[0]
    }

    // 2. Fallback: check any active global connection (e.g. system admin workspace)
    if (!connection) {
      connection = await prisma.slackConnection.findFirst({
        where: { connected: true },
        orderBy: { updatedAt: 'desc' },
      })
    }

    if (!connection || !connection.connected || !connection.accessToken) {
      logger.info(
        `[Slack] Slack is not connected for sender ${senderEmail}. Scheduling continues normally without notification.`
      )
      return { sent: false, reason: 'NOT_CONNECTED' }
    }

    // ── C. Decrypt Token & Resolve Destination Channel ────────────
    const token = decrypt(connection.accessToken)
    const channel = connection.channelId || connection.slackUserId || 'general'

    // Format human-friendly time string
    const timeFormatted = nextAvailableTime.toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'medium',
    }) + ' UTC'

    const fallbackText = `⚠️ ReachInbox Rate Limit Alert: Sender ${senderEmail} reached hourly limit of ${hourlyLimit} emails/hr. Next window opens at ${timeFormatted}.`

    // ── D. Send Message via Slack Web API chat.postMessage ─────────
    const slackPayload = {
      channel,
      text: fallbackText,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚠️ ReachInbox — Hourly Sending Limit Reached',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Sender *${senderEmail}* has reached its configured hourly sending capacity.`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*📧 Sender Email:*\n\`${senderEmail}\``,
            },
            {
              type: 'mrkdwn',
              text: `*⚡ Hourly Quota:*\n*${hourlyLimit}* emails / hour`,
            },
            {
              type: 'mrkdwn',
              text: `*⏰ Next Available Window:*\n*${timeFormatted}*`,
            },
            {
              type: 'mrkdwn',
              text: `*📦 Queue Status:*\nRemaining jobs safely delayed in BullMQ`,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '🛡️ *Zero Job Loss:* Emails will dispatch automatically once the hourly sliding window opens. No jobs are failed or dropped.',
            },
          ],
        },
      ],
    }

    const response = await axios.post('https://slack.com/api/chat.postMessage', slackPayload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      timeout: 8000,
    })

    if (response.data && response.data.ok) {
      logger.info(
        `[Slack] ✅ Real Slack rate-limit notification sent to channel ${channel} for sender ${senderEmail} (ts: ${response.data.ts})`
      )
      return { sent: true, reason: 'SUCCESS', ts: response.data.ts }
    } else {
      logger.warn(
        `[Slack] ⚠️ Slack API returned error when sending notification: ${response.data?.error || 'Unknown error'}`
      )
      return { sent: false, reason: 'ERROR', error: response.data?.error }
    }
  } catch (error: any) {
    logger.warn(`[Slack] Failed to send rate-limit alert (non-fatal):`, error.message)
    return { sent: false, reason: 'ERROR', error: error.message }
  }
}

/**
 * 6. Sends a test message to verify the connected Slack workspace
 */
export async function sendSlackTestMessage(userId: string): Promise<{ success: boolean; error?: string; ts?: string }> {
  const connection = await prisma.slackConnection.findFirst({
    where: { userId, connected: true },
    orderBy: { updatedAt: 'desc' },
  })

  if (!connection || !connection.accessToken) {
    return { success: false, error: 'No active Slack connection found for this account' }
  }

  try {
    const token = decrypt(connection.accessToken)
    const channel = connection.channelId || connection.slackUserId || 'general'

    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel,
        text: '🚀 *ReachInbox*: Slack connection verified successfully! You will receive instant notifications here when senders reach their hourly rate limit.',
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        timeout: 8000,
      }
    )

    if (response.data?.ok) {
      return { success: true, ts: response.data.ts }
    } else {
      return { success: false, error: response.data?.error || 'Slack API error' }
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

