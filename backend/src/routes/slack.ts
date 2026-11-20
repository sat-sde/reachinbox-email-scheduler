import { Router, Request, Response, NextFunction } from 'express'
import { env } from '../config/env'
import { requireAuth } from '../middleware/auth'
import {
  getSlackAuthUrl,
  exchangeSlackCode,
  getSlackConnectionStatus,
  disconnectSlackConnection,
  sendSlackTestMessage,
} from '../services/slackService'
import { logger } from '../utils/logger'

const router = Router()

// ── GET /api/slack/connect ─────────────────────────────────────────
/**
 * Initiates the Slack OAuth 2.0 authorization flow.
 * Redirects the user to Slack's authorization screen with the minimum
 * required scopes ('chat:write,incoming-webhook').
 */
router.get('/connect', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Resolve userId from req.user, cookie, or query param
    let userId = (req.user as any)?.id

    if (!userId && req.cookies?.reachinbox_token) {
      try {
        const decoded = (await import('jsonwebtoken')).default.verify(
          req.cookies.reachinbox_token,
          env.JWT_SECRET
        ) as { userId: string }
        userId = decoded.userId
      } catch (tokenErr) {
        // invalid token
      }
    }

    if (!userId && typeof req.query.token === 'string') {
      try {
        const decoded = (await import('jsonwebtoken')).default.verify(
          req.query.token,
          env.JWT_SECRET
        ) as { userId: string }
        userId = decoded.userId
      } catch (tokenErr) {
        // invalid token
      }
    }

    if (!userId && typeof req.query.userId === 'string') {
      userId = req.query.userId
    }

    if (!userId) {
      // If user isn't logged in, redirect them to login page
      res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Please log in before connecting Slack')}`)
      return
    }

    const { url, configured, message } = getSlackAuthUrl(userId)

    if (!configured) {
      logger.warn(`Slack OAuth not configured: ${message}`)
      res.redirect(
        `${env.FRONTEND_URL}/dashboard?slack=error&message=${encodeURIComponent(
          message || 'Slack OAuth credentials are not configured on the server'
        )}`
      )
      return
    }

    logger.info(`Redirecting user ${userId} to Slack OAuth authorization: ${url}`)
    res.redirect(url)
  } catch (error) {
    next(error)
  }
})

// ── GET /api/slack/callback ────────────────────────────────────────
/**
 * Handles redirect from Slack OAuth authorization.
 * Exchanges the temporary code for an access token and stores it securely
 * encrypted in PostgreSQL against the authenticated user.
 */
router.get('/callback', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const code = req.query.code as string
    const state = req.query.state as string
    const error = req.query.error as string

    if (error) {
      logger.warn(`Slack authorization was denied or resulted in error: ${error}`)
      res.redirect(
        `${env.FRONTEND_URL}/dashboard?slack=error&message=${encodeURIComponent(`Slack authorization denied: ${error}`)}`
      )
      return
    }

    if (!code || !state) {
      res.redirect(
        `${env.FRONTEND_URL}/dashboard?slack=error&message=${encodeURIComponent('Missing OAuth code or state parameter')}`
      )
      return
    }

    // Exchange code for token and save in PostgreSQL
    const result = await exchangeSlackCode(code, state)

    if (!result.success) {
      res.redirect(
        `${env.FRONTEND_URL}/dashboard?slack=error&message=${encodeURIComponent(result.error || 'Failed to complete Slack connection')}`
      )
      return
    }

    logger.info(`Successfully linked Slack workspace for team: ${result.connection?.teamName || result.connection?.teamId}`)
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=connected`)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/slack/status ──────────────────────────────────────────
/**
 * Returns the current Slack connection status for the logged-in user.
 * Never exposes the access token to the frontend.
 */
router.get('/status', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as any
    const status = await getSlackConnectionStatus(user.id)

    res.json({
      success: true,
      connected: status.connected,
      connection: status.connection,
    })
  } catch (error) {
    next(error)
  }
})

// ── POST /api/slack/disconnect ─────────────────────────────────────
/**
 * Disconnects the Slack workspace for the authenticated user.
 */
router.post('/disconnect', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as any
    await disconnectSlackConnection(user.id)

    res.json({
      success: true,
      message: 'Slack workspace disconnected successfully',
    })
  } catch (error) {
    next(error)
  }
})

// ── POST /api/slack/test ───────────────────────────────────────────
/**
 * Sends a test Slack notification to verify integration end-to-end.
 */
router.post('/test', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user as any
    const result = await sendSlackTestMessage(user.id)

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
      })
      return
    }

    res.json({
      success: true,
      message: 'Test alert sent to Slack successfully!',
      ts: result.ts,
    })
  } catch (error) {
    next(error)
  }
})

export default router
