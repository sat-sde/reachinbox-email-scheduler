import { Router, Request, Response } from 'express'
import { isDatabaseHealthy } from '../config/prisma'

const router = Router()

/**
 * GET /api/health
 * Comprehensive health check API
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const dbHealthy = await isDatabaseHealthy()
  const uptimeSeconds = Math.floor(process.uptime())

  const healthData = {
    status: dbHealthy ? 'healthy' : 'degraded',
    service: 'reachinbox-backend',
    timestamp: new Date().toISOString(),
    uptime: `${uptimeSeconds}s`,
    database: {
      status: dbHealthy ? 'connected' : 'disconnected',
    },
    system: {
      nodeVersion: process.version,
      memoryUsage: {
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      },
    },
  }

  const statusCode = dbHealthy ? 200 : 503
  res.status(statusCode).json(healthData)
})

export default router
