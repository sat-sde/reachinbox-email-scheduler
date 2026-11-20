import express, { Application } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import passport from 'passport'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'

import { env } from './config/env'
import { emailQueue } from './jobs/emailQueue'
import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import { rateLimiter } from './middleware/rateLimiter'
import { requireAuth } from './middleware/auth'
import { requireAdminAuth } from './middleware/adminAuth'
import { initElasticsearchIndex } from './services/elasticsearchService'

// Routers
import healthRouter from './routes/health'
import authRouter from './routes/auth'
import emailRouter from './routes/emails'
import sendersRouter from './routes/senders'
import schedulerRouter from './routes/scheduler'
import slackRouter from './routes/slack'

export function createApp(): Application {
  const app = express()

  // ── Security & Basic Middleware ────────────────────────────────
  app.use(helmet())
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true, // Allow cookies across origins
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    })
  )
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'))
  app.use(cookieParser())
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))

  // ── Session & Passport Authentication ──────────────────────────
  app.use(
    session({
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    })
  )
  app.use(passport.initialize())
  app.use(passport.session())

  // ── Bull Board (Job Monitor UI) ────────────────────────────────
  // Protected queue dashboard accessible to administrators at /admin/queues
  const serverAdapter = new ExpressAdapter()
  serverAdapter.setBasePath('/admin/queues')
  createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter })
  app.use('/admin/queues', requireAdminAuth, serverAdapter.getRouter())

  // Initialize Elasticsearch index mapping asynchronously
  initElasticsearchIndex().catch(() => {})

  // ── Rate Limiting ──────────────────────────────────────────────
  app.use('/api/', rateLimiter)

  // ── Health Check ───────────────────────────────────────────────
  app.use('/api/health', healthRouter)

  // ── Authentication Routes ──────────────────────────────────────
  app.use('/auth', authRouter)
  app.use('/api/auth', authRouter)

  // ── Protected Application API Routes ───────────────────────────
  app.use('/api/senders', requireAuth, sendersRouter)
  app.use('/api/emails', requireAuth, emailRouter)
  app.use('/api/scheduler', requireAuth, schedulerRouter)

  // ── Slack OAuth & Integration Routes ───────────────────────────
  app.use('/api/slack', slackRouter)
  app.use('/api/auth/slack', slackRouter)

  // ── 404 & Centralized Error Handlers ───────────────────────────
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
