import { Router, Request, Response } from 'express'
import { emailQueue } from '../jobs/emailQueue'
import { logger } from '../utils/logger'

const router = Router()

// GET /api/scheduler/jobs — List all jobs in the queue
router.get('/jobs', async (_req: Request, res: Response) => {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      emailQueue.getWaiting(),
      emailQueue.getActive(),
      emailQueue.getCompleted(0, 20),
      emailQueue.getFailed(0, 20),
      emailQueue.getDelayed(),
    ])
    res.json({ waiting, active, completed, failed, delayed })
  } catch (err) {
    logger.error('Get jobs error', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// GET /api/scheduler/stats — Queue statistics
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const counts = await emailQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
    res.json(counts)
  } catch (err) {
    logger.error('Get stats error', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

export default router

