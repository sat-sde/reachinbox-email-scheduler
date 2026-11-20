import { Router, Request, Response, NextFunction } from 'express'
import passport from 'passport'
import { Strategy as GoogleStrategy, Profile, VerifyCallback } from 'passport-google-oauth20'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { prisma } from '../config/prisma'
import { logger } from '../utils/logger'
import { requireAuth } from '../middleware/auth'
import { encrypt } from '../utils/crypto'

const router = Router()

export const COOKIE_NAME = 'reachinbox_token'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000 // 7 days

// Helper to sign JWT authentication token
export function generateAuthToken(user: { id: string; email: string }): string {
  return jwt.sign(
    { userId: user.id, email: user.email },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  )
}

// ── Google OAuth 2.0 Strategy Configuration ───────────────────────
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: VerifyCallback
      ) => {
        try {
          const email = profile.emails?.[0]?.value
          if (!email) {
            return done(new Error('No email found in Google account profile'))
          }

          const googleId = profile.id
          const name = profile.displayName || `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() || 'Google User'
          const avatar = profile.photos?.[0]?.value || null

          // Look for user by googleId or email in PostgreSQL
          const existingUser = await prisma.user.findFirst({
            where: {
              OR: [{ googleId }, { email }],
            },
          })

          let user
          if (existingUser) {
            // Update existing user with latest Google info
            user = await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                name,
                avatar: avatar || existingUser.avatar,
                googleId,
              },
            })
            logger.info(`Existing user logged in via Google: ${email} (${user.id})`)
          } else {
            // Create new user in PostgreSQL
            user = await prisma.user.create({
              data: {
                email,
                name,
                avatar,
                googleId,
              },
            })
            logger.info(`New user registered via Google: ${email} (${user.id})`)
          }

          return done(null, user)
        } catch (error) {
          logger.error('Google OAuth verification error:', error)
          return done(error as Error)
        }
      }
    )
  )
} else {
  logger.warn('⚠️ Google OAuth credentials missing. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env')
}

// Serialize & deserialize user for passport session compatibility
passport.serializeUser((user: any, done) => done(null, user.id))
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } })
    done(null, user)
  } catch (err) {
    done(err)
  }
})

// ── GET /auth/google (Initiate Google OAuth Flow) ──────────────────
router.get('/google', (req: Request, res: Response, next: NextFunction): void => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    res.status(503).json({
      success: false,
      message: 'Google OAuth 2.0 is not configured on the server. Please check backend/.env configuration.',
    })
    return
  }

  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    prompt: 'select_account',
  })(req, res, next)
})

// ── GET /auth/dev-login (Development Demo Login for UI Testing) ───
router.get('/dev-login', async (req: Request, res: Response): Promise<void> => {
  try {
    let user = await prisma.user.findFirst({
      where: { email: 'demo@reachinbox.ai' },
      include: { senders: true },
    })

    if (!user) {
      user = await prisma.user.create({
        data: {
          name: 'Alex Morgan',
          email: 'demo@reachinbox.ai',
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
          googleId: 'google-dev-demo-12345',
        },
        include: { senders: true },
      })
    }

    // Ensure demo user has an active sender
    let sender = user.senders?.[0]
    if (!sender) {
      sender = await prisma.sender.create({
        data: {
          userId: user.id,
          name: 'ReachInbox Growth',
          email: env.SMTP_FROM || 'growth@reachinbox.ethereal.email',
          host: env.SMTP_HOST || 'smtp.ethereal.email',
          port: env.SMTP_PORT || 587,
          etherealUser: encrypt(env.SMTP_USER || 'reachinbox_demo'),
          etherealPass: encrypt(env.SMTP_PASS || 'reachinbox_pass'),
          hourlyLimit: 100,
          enabled: true,
        },
      })
    }

    // Ensure sample emails exist for realistic dashboard display
    const emailCount = await prisma.email.count({ where: { userId: user.id } })
    if (emailCount === 0) {
      await prisma.email.createMany({
        data: [
          {
            userId: user.id,
            senderId: sender.id,
            recipient: 'sarah.connor@acme-corp.com',
            subject: 'Scaling outreach pipeline with ReachInbox',
            body: '<p>Hi Sarah, would love to connect about automating your cold email infrastructure with BullMQ and Redis.</p>',
            scheduledAt: new Date(Date.now() + 3600000),
            status: 'scheduled',
          },
          {
            userId: user.id,
            senderId: sender.id,
            recipient: 'david.chen@fintech-global.io',
            subject: 'Partnership inquiry: BullMQ + distributed queues',
            body: '<p>Hi David, following up on our discussion regarding asynchronous job processing and rate limits.</p>',
            scheduledAt: new Date(Date.now() + 7200000),
            status: 'scheduled',
          },
          {
            userId: user.id,
            senderId: sender.id,
            recipient: 'elena.rostova@venture-ai.com',
            subject: 'Demo invitation: ReachInbox Email Scheduler',
            body: '<p>Hi Elena, here is the demo link we discussed for queue management, distributed rate limiting, and Slack alerts.</p>',
            scheduledAt: new Date(Date.now() - 3600000),
            sentAt: new Date(Date.now() - 3590000),
            status: 'sent',
            previewUrl: 'https://ethereal.email/message/WaQKMgKddxQDoou...demo',
          },
        ],
      })
    }

    const token = generateAuthToken(user)

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    })

    logger.info(`Dev demo login successful for ${user.email}. Cookie set. Redirecting to dashboard.`)
    res.redirect(`${env.FRONTEND_URL}/dashboard?auth=demo`)
  } catch (err: any) {
    logger.error('Dev login error:', err)
    res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(err.message)}`)
  }
})

// ── GET /auth/google/callback (Google OAuth Redirect Callback) ────
router.get(
  '/google/callback',
  (req: Request, res: Response, next: NextFunction): void => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Google OAuth is not configured on server')}`)
      return
    }

    passport.authenticate(
      'google',
      { session: false },
      (err: Error | null, user: any, info: any) => {
        if (err || !user) {
          const errorMessage = err?.message || info?.message || 'Authentication failed'
          logger.error('Google OAuth callback failed:', { error: errorMessage })
          res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(errorMessage)}`)
          return
        }

        try {
          // Generate JWT token
          const token = generateAuthToken(user)

          // Set secure HTTP-only cookie
          res.cookie(COOKIE_NAME, token, {
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: COOKIE_MAX_AGE,
            path: '/',
          })

          logger.info(`Authentication successful for ${user.email}. Cookie set. Redirecting to dashboard.`)
          res.redirect(`${env.FRONTEND_URL}/dashboard?auth=success`)
        } catch (tokenError) {
          logger.error('Failed to issue token after Google OAuth:', tokenError)
          res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Failed to generate session')}`)
        }
      }
    )(req, res, next)
  }
)

// ── GET /api/auth/me (Get Authenticated User) ──────────────────────
router.get('/me', requireAuth, (req: Request, res: Response): void => {
  const user = req.user as any
  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      googleId: user.googleId,
      createdAt: user.createdAt,
    },
  })
})

// ── POST /api/auth/logout (Logout and Clear Cookie) ───────────────
router.post('/logout', (req: Request, res: Response): void => {
  // Clear the secure HTTP-only cookie
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  // Destroy session if present
  if (req.session) {
    req.session.destroy(() => {})
  }

  logger.info('User logged out successfully')
  res.json({
    success: true,
    message: 'Logged out successfully',
  })
})

export default router
