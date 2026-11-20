import { Router, Request, Response } from 'express'
import { isDatabaseHealthy } from '../config/prisma'
import { redisConnection } from '../config/redis'
import { esClient } from '../config/elasticsearch'

const router = Router()

/**
 * GET /api/health
 * Comprehensive health check API checking PostgreSQL, Redis, Elasticsearch, and Node runtime
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const dbHealthy = await isDatabaseHealthy()

  let redisHealthy = false
  try {
    const pong = await redisConnection.ping()
    redisHealthy = pong === 'PONG'
  } catch {
    redisHealthy = false
  }

  let esHealthy = false
  try {
    esHealthy = await esClient.ping()
  } catch {
    esHealthy = false
  }

  const allHealthy = dbHealthy && redisHealthy
  const uptimeSeconds = Math.floor(process.uptime())

  const healthData = {
    status: allHealthy ? 'healthy' : 'degraded',
    service: 'reachinbox-backend',
    timestamp: new Date().toISOString(),
    uptime: `${uptimeSeconds}s`,
    database: {
      type: 'PostgreSQL 16',
      status: dbHealthy ? 'connected' : 'disconnected',
    },
    redis: {
      status: redisHealthy ? 'connected' : 'disconnected',
    },
    elasticsearch: {
      status: esHealthy ? 'connected' : 'disconnected',
    },
    system: {
      nodeVersion: process.version,
      memoryUsage: {
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      },
    },
  }

  const statusCode = allHealthy ? 200 : 503
  res.status(statusCode).json(healthData)
})

export default router
