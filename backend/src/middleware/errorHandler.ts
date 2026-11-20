import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { AppError } from '../utils/errors'
import { logger } from '../utils/logger'
import { env } from '../config/env'

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 1. Operational AppError
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.errors ? { errors: err.errors } : {}),
      ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
    })
    return
  }

  // 2. Zod Validation Error
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }))

    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: formattedErrors,
    })
    return
  }

  // 3. Prisma Known Request Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : 'field'
      res.status(409).json({
        success: false,
        message: `Unique constraint violation on ${target}`,
      })
      return
    }

    if (err.code === 'P2025') {
      res.status(404).json({
        success: false,
        message: (err.meta?.cause as string) || 'Record not found',
      })
      return
    }

    res.status(400).json({
      success: false,
      message: 'Database query error',
      code: err.code,
    })
    return
  }

  // 4. Unexpected / System Errors
  logger.error('Unhandled server error', { error: err.message, stack: err.stack })

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...(env.NODE_ENV === 'development' ? { error: err.message, stack: err.stack } : {}),
  })
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  const error = new AppError(`Cannot ${req.method} ${req.originalUrl}`, 404)
  next(error)
}

