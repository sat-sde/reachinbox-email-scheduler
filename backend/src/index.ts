import { createApp } from './app'
import { env } from './config/env'
import { connectDatabase, disconnectDatabase } from './config/prisma'
import { logger } from './utils/logger'
import http from 'http'

const app = createApp()
const server = http.createServer(app)

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
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

// ── Graceful Shutdown ────────────────────────────────────────────
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Shutting down gracefully...`)

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
