import { redisConnection } from '../config/redis'
import { env } from '../config/env'
import { logger } from '../utils/logger'

export interface RateLimitReservationResult {
  allowed: boolean
  delayNeededMs: number
  reason: 'ALLOWED' | 'HOURLY_LIMIT_EXCEEDED' | 'MIN_DELAY_ENFORCED'
  currentCount: number
  nextAvailableTime?: Date
}

// ── Atomic Lua Script for Distributed Sender Rate Limiting ────────
/**
 * Atomic Lua script that performs both sliding-window hourly quota check
 * and minimum delay check in a single atomic Redis round-trip.
 *
 * KEYS[1]: ZSET storing timestamps of sent emails (ratelimit:sender:<id>:hourly)
 * KEYS[2]: STRING storing timestamp of the last dispatched email (ratelimit:sender:<id>:last_send)
 *
 * ARGV[1]: current timestamp in milliseconds (now)
 * ARGV[2]: sliding window size in milliseconds (e.g. 3600000 = 1 hour)
 * ARGV[3]: maximum allowed emails in the window
 * ARGV[4]: minimum delay between consecutive emails in milliseconds
 * ARGV[5]: unique email or job ID
 *
 * Returns an array: { allowed (1 or 0), delayNeededMs, reason, currentCount }
 */
const RATE_LIMIT_LUA_SCRIPT = `
local hourlyKey = KEYS[1]
local lastSendKey = KEYS[2]

local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxLimit = tonumber(ARGV[3])
local minDelayMs = tonumber(ARGV[4])
local memberId = ARGV[5]

-- 1. Purge expired entries older than (now - windowMs)
local windowStart = now - windowMs
redis.call('ZREMRANGEBYSCORE', hourlyKey, '-inf', windowStart)

-- 2. Count active sends in the current sliding window
local currentCount = redis.call('ZCARD', hourlyKey)

-- 3. Check hourly limit
if currentCount >= maxLimit then
  -- Find the oldest email timestamp in the window
  local oldest = redis.call('ZRANGE', hourlyKey, 0, 0, 'WITHSCORES')
  local delayNeeded = 1000 -- Fallback 1 second
  if oldest and #oldest >= 2 then
    local oldestTimestamp = tonumber(oldest[2])
    -- The next slot becomes available exactly when the oldest entry expires
    local nextAvailable = oldestTimestamp + windowMs
    delayNeeded = math.max(1000, (nextAvailable - now) + 100) -- +100ms jitter buffer
  end
  return {0, delayNeeded, "HOURLY_LIMIT_EXCEEDED", currentCount}
end

-- 4. Check minimum delay between consecutive sends
local lastSend = redis.call('GET', lastSendKey)
if lastSend then
  local lastSendTime = tonumber(lastSend)
  local elapsed = now - lastSendTime
  if elapsed < minDelayMs then
    local delayNeeded = minDelayMs - elapsed
    return {0, delayNeeded, "MIN_DELAY_ENFORCED", currentCount}
  end
end

-- 5. Limit satisfied and min delay respected -> Atomically reserve the slot!
redis.call('ZADD', hourlyKey, now, now .. ':' .. memberId)
redis.call('PEXPIRE', hourlyKey, windowMs * 2)
redis.call('SET', lastSendKey, now, 'PX', windowMs * 2)

return {1, 0, "ALLOWED", currentCount + 1}
`

// One hour window in milliseconds
export const DEFAULT_WINDOW_MS = 60 * 60 * 1000

/**
 * Atomically attempts to reserve a rate-limited sending slot in Redis.
 * Works across multiple workers, threads, and container instances.
 * Never uses in-memory state.
 */
export async function reserveSenderSlot(options: {
  senderId: string
  emailId: string
  maxHourlyLimit?: number
  minDelayMs?: number
  windowMs?: number
}): Promise<RateLimitReservationResult> {
  const { senderId, emailId } = options
  const now = Date.now()
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const maxHourlyLimit = options.maxHourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER
  const minDelayMs = options.minDelayMs ?? env.MIN_DELAY_BETWEEN_EMAILS_MS

  const hourlyKey = `ratelimit:sender:${senderId}:hourly`
  const lastSendKey = `ratelimit:sender:${senderId}:last_send`

  try {
    const rawResult = (await redisConnection.eval(
      RATE_LIMIT_LUA_SCRIPT,
      2,
      hourlyKey,
      lastSendKey,
      now.toString(),
      windowMs.toString(),
      maxHourlyLimit.toString(),
      minDelayMs.toString(),
      emailId
    )) as [number, number, string, number]

    const [allowedFlag, delayNeeded, reason, currentCount] = rawResult
    const allowed = allowedFlag === 1

    const result: RateLimitReservationResult = {
      allowed,
      delayNeededMs: Math.max(0, Math.ceil(delayNeeded)),
      reason: reason as any,
      currentCount,
      nextAvailableTime: allowed ? undefined : new Date(now + delayNeeded),
    }

    if (!allowed) {
      logger.info(
        `[RateLimiter] Sender ${senderId} rate limit triggered (${reason}). ` +
          `Count: ${currentCount}/${maxHourlyLimit}. Delaying by ${result.delayNeededMs}ms ` +
          `(Available at: ${result.nextAvailableTime?.toISOString()})`
      )
    }

    return result
  } catch (error) {
    logger.error(`[RateLimiter] Redis rate limiting error for sender ${senderId}:`, error)
    // On unexpected Redis error, fail open or safely defer to avoid crashing worker
    return {
      allowed: false,
      delayNeededMs: 5000,
      reason: 'HOURLY_LIMIT_EXCEEDED',
      currentCount: 0,
      nextAvailableTime: new Date(now + 5000),
    }
  }
}

/**
 * Releases a reserved slot in case of network or unrecoverable pre-SMTP failure
 */
export async function releaseSenderSlot(
  senderId: string,
  emailId: string
): Promise<void> {
  try {
    const hourlyKey = `ratelimit:sender:${senderId}:hourly`
    // Find matching member ending with :emailId
    const members = await redisConnection.zrange(hourlyKey, 0, -1)
    const targetMember = members.find((m) => m.endsWith(`:${emailId}`))
    if (targetMember) {
      await redisConnection.zrem(hourlyKey, targetMember)
      logger.info(`[RateLimiter] Released slot for sender ${senderId}, email ${emailId}`)
    }
  } catch (error) {
    logger.warn(`[RateLimiter] Failed to release slot for sender ${senderId}:`, error)
  }
}

/**
 * Retrieves live rate limit telemetry for a sender directly from Redis
 */
export async function getSenderRateLimitStatus(senderId: string, windowMs = DEFAULT_WINDOW_MS): Promise<{
  currentCount: number
  oldestEmailTimestamp?: Date
  lastSendTimestamp?: Date
}> {
  const hourlyKey = `ratelimit:sender:${senderId}:hourly`
  const lastSendKey = `ratelimit:sender:${senderId}:last_send`
  const now = Date.now()

  // Purge expired
  await redisConnection.zremrangebyscore(hourlyKey, '-inf', now - windowMs)
  const count = await redisConnection.zcard(hourlyKey)
  const oldest = await redisConnection.zrange(hourlyKey, 0, 0, 'WITHSCORES')
  const lastSend = await redisConnection.get(lastSendKey)

  return {
    currentCount: count,
    oldestEmailTimestamp: oldest && oldest.length >= 2 ? new Date(Number(oldest[1])) : undefined,
    lastSendTimestamp: lastSend ? new Date(Number(lastSend)) : undefined,
  }
}

