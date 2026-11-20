import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { prisma } from '../config/prisma'
import { logger } from '../utils/logger'

/**
 * Administrative Authentication Guard for Bull Board (/admin/queues).
 *
 * Supports two authentication paths:
 * 1. Logged-in admin session via HTTP-only cookie or Bearer token (JWT)
 * 2. HTTP Basic Authentication (RFC 7617) for direct browser or CLI access
 *
 * Configurable credentials:
 * - BULL_BOARD_USER (default: 'admin')
 * - BULL_BOARD_PASS (default: 'admin123')
 */
export async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const adminUser = process.env.BULL_BOARD_USER || 'admin'
  const adminPass = process.env.BULL_BOARD_PASS || 'admin123'

  // 1. Check HTTP-only cookie or Bearer token
  const token =
    req.cookies?.reachinbox_token ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null)

  if (token) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string }
      const user = await prisma.user.findUnique({ where: { id: decoded.userId } })
      if (user) {
        req.user = user
        return next()
      }
    } catch (jwtErr) {
      // Invalid JWT, continue to Basic Auth check
    }
  }

  // 2. Check HTTP Basic Authentication
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const b64Credentials = authHeader.split(' ')[1]
      const credentials = Buffer.from(b64Credentials, 'base64').toString('utf8')
      const [username, password] = credentials.split(':')

      if (username === adminUser && password === adminPass) {
        return next()
      }
    } catch (parseErr) {
      logger.warn('Failed to parse Basic Auth credentials in adminAuth')
    }
  }

  // 3. Unauthorized: challenge with HTTP Basic Auth
  logger.warn(`Unauthorized attempt to access Bull Board dashboard from ${req.ip} (${req.originalUrl})`)
  res.setHeader('WWW-Authenticate', 'Basic realm="ReachInbox Queue Administration"')
  res.status(401).send('Unauthorized: Administrative credentials required to view queue dashboard.')
}
