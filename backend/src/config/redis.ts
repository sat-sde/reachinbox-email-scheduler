import IORedis from 'ioredis'
import { env } from './env'
import { logger } from '../utils/logger'

export const redisConnection = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
})

redisConnection.on('connect', () => logger.info('✅ Redis connected'))
redisConnection.on('error', (err) => logger.error('Redis error', err))

