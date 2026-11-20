import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { prisma } from '../config/prisma'
import { logger } from '../utils/logger'
import { UnauthorizedError } from '../utils/errors'

export interface JwtPayload {
  userId: string
  email: string
}

/**
 * Middleware to require authentication via HTTP-only cookie or Bearer token.
 * Populates req.user with the PostgreSQL user record.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // 1. Look for token in HTTP-only cookie or Authorization header
    let token: string | undefined = req.cookies?.reachinbox_token

    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1]
    }

    if (!token) {
      logger.warn(`Unauthorized access attempt to ${req.originalUrl} - No token found`)
      res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
      })
      return
    }

    // 2. Verify JWT signature
    let decoded: JwtPayload
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload
    } catch (jwtError) {
      logger.warn(`Invalid JWT token on ${req.originalUrl}:`, jwtError)
      res.status(401).json({
        success: false,
        message: 'Invalid or expired session. Please log in again.',
      })
      return
    }

    // 3. Fetch user from PostgreSQL
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    })

    if (!user) {
      logger.warn(`User ${decoded.userId} not found in database`)
      res.status(401).json({
        success: false,
        message: 'User account not found. Please log in again.',
      })
      return
    }

    // 4. Attach user to request
    req.user = user
    next()
  } catch (error) {
    logger.error('Authentication middleware error:', error)
    next(new UnauthorizedError('Authentication failed'))
  }
}
