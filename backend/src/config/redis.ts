import IORedis from 'ioredis'
import { env } from './env'
import { logger } from '../utils/logger'

// Support both REDIS_URL (Render/Heroku/Upstash) and individual host/port/password
export const redisConnection = env.REDIS_URL
  ? new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
    })
  : new IORedis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
    })

redisConnection.on('connect', () => logger.info('✅ Redis connected'))
redisConnection.on('error', (err) => logger.error('Redis error', err))

