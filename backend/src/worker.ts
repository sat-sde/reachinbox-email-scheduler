import { createEmailWorker } from './jobs/emailWorker'
import { connectDatabase, disconnectDatabase } from './config/prisma'
import { logger } from './utils/logger'
import { env } from './config/env'
import { EMAIL_QUEUE_NAME } from './jobs/emailQueue'

/**
 * Standalone BullMQ Worker Process for ReachInbox Email Scheduler.
 * Runs completely decoupled from the Express API server process.
 */
async function startWorkerProcess(): Promise<void> {
  logger.info('====================================================')
  logger.info('🚀 Starting Standalone ReachInbox BullMQ Worker Process')
  logger.info(`📦 Queue Name: ${EMAIL_QUEUE_NAME}`)
  logger.info(`⚙️  Worker Concurrency: ${env.WORKER_CONCURRENCY}`)
  logger.info(`🌍 Environment: ${env.NODE_ENV}`)
  logger.info('====================================================')

  try {
    // 1. Verify Database connectivity
    await connectDatabase()

    // 2. Start the BullMQ Worker
    const worker = createEmailWorker()

    logger.info('✅ Worker process is actively listening for delayed and ready email jobs...')

    // ── Graceful Shutdown Handling ─────────────────────────────────
    const handleShutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down worker process gracefully...`)
      try {
        await worker.close()
        logger.info('BullMQ worker closed successfully')
        await disconnectDatabase()
        logger.info('Worker process terminated cleanly')
        process.exit(0)
      } catch (err) {
        logger.error('Error during worker shutdown:', err)
        process.exit(1)
      }
    }

    process.on('SIGINT', () => handleShutdown('SIGINT'))
    process.on('SIGTERM', () => handleShutdown('SIGTERM'))
  } catch (error) {
    logger.error('Failed to start worker process:', error)
    process.exit(1)
  }
}

// Bootstrap standalone worker process
startWorkerProcess()

