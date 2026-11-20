import { createApp } from './app'
import { env } from './config/env'
import { connectDatabase, disconnectDatabase } from './config/prisma'
import { createEmailWorker } from './jobs/emailWorker'
import { logger } from './utils/logger'
import http from 'http'

const app = createApp()
const server = http.createServer(app)
let embeddedWorker: any = null

async function startServer(): Promise<void> {
  try {
    // 1. Connect to PostgreSQL
    await connectDatabase()

    // 2. Start HTTP server
    server.listen(env.PORT, () => {
      logger.info(`🚀 ReachInbox Backend Server running on http://localhost:${env.PORT}`)
      logger.info(`🏥 Health check available at http://localhost:${env.PORT}/api/health`)
      logger.info(`🌍 Environment: ${env.NODE_ENV}`)
    })

    // 3. Optionally launch embedded BullMQ worker in the same process
    if (env.EMBED_WORKER) {
      logger.info('⚙️ Starting embedded BullMQ worker inside API process (EMBED_WORKER=true)...')
      embeddedWorker = createEmailWorker()
      logger.info('✅ Embedded worker is actively processing email jobs.')
    }
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

// ── Graceful Shutdown ────────────────────────────────────────────
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Shutting down gracefully...`)

  if (embeddedWorker) {
    try {
      await embeddedWorker.close()
      logger.info('Embedded BullMQ worker closed')
    } catch (e) {
      logger.warn('Error closing embedded worker:', e)
    }
  }

  server.close(async () => {
    logger.info('HTTP server closed')
    await disconnectDatabase()
    process.exit(0)
  })

  // Force shutdown after 10 seconds if not closed
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Bootstrap
startServer()

export { app, server }
