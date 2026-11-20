import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
    ],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

/**
 * Connect to PostgreSQL and verify connection
 */
export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect()
    // Perform a lightweight query to verify active connectivity
    await prisma.$queryRaw`SELECT 1`
    logger.info('✅ PostgreSQL connected successfully via Prisma')
  } catch (error) {
    logger.error('❌ Failed to connect to PostgreSQL database:', error)
    throw error
  }
}

/**
 * Gracefully disconnect from database
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect()
    logger.info('Database connection closed')
  } catch (error) {
    logger.error('Error disconnecting database:', error)
  }
}

/**
 * Health check helper for database
 */
export async function isDatabaseHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}
