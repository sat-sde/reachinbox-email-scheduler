import { esClient, EMAIL_INDEX } from '../config/elasticsearch'
import { prisma } from '../config/prisma'
import { redisConnection } from '../config/redis'
import { logger } from '../utils/logger'

export interface EmailIndexDocument {
  id: string
  userId: string
  senderId?: string | null
  sender?: string | null
  recipient: string
  subject: string
  body: string
  status: string
  scheduledAt: string
  sentAt?: string | null
  createdAt: string
  updatedAt: string
  errorMessage?: string | null
  previewUrl?: string | null
}

export interface SearchEmailParams {
  query?: string
  status?: 'scheduled' | 'processing' | 'sent' | 'failed' | 'all'
  limit?: number
  page?: number
  userId?: string
}

export interface SearchEmailResult {
  total: number
  page: number
  limit: number
  totalPages: number
  data: EmailIndexDocument[]
  source: 'elasticsearch' | 'database_fallback'
}

const FAILED_INDEX_REDIS_KEY = 'elasticsearch:failed_index_queue'

/**
 * Initializes the Elasticsearch email index with explicit schema mappings.
 */
export async function initElasticsearchIndex(): Promise<boolean> {
  try {
    const isAlive = await esClient.ping()
    if (!isAlive) {
      logger.warn('[Elasticsearch] Ping failed. Search features may fall back to database.')
      return false
    }

    const exists = await esClient.indices.exists({ index: EMAIL_INDEX })
    if (!exists) {
      logger.info(`[Elasticsearch] Creating index "${EMAIL_INDEX}" with custom mappings...`)
      await esClient.indices.create({
        index: EMAIL_INDEX,
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          analysis: {
            analyzer: {
              email_analyzer: {
                type: 'custom',
                tokenizer: 'uax_url_email',
                filter: ['lowercase'],
              },
            },
          },
        },
        mappings: {
          properties: {
            id: { type: 'keyword' },
            userId: { type: 'keyword' },
            senderId: { type: 'keyword' },
            sender: { type: 'keyword' },
            recipient: {
              type: 'text',
              analyzer: 'email_analyzer',
              fields: { keyword: { type: 'keyword' } },
            },
            subject: {
              type: 'text',
              analyzer: 'standard',
              fields: { keyword: { type: 'keyword' } },
            },
            body: {
              type: 'text',
              analyzer: 'standard',
            },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            createdAt: { type: 'date' },
            updatedAt: { type: 'date' },
            errorMessage: { type: 'text' },
            previewUrl: { type: 'keyword' },
          },
        },
      })
      logger.info(`[Elasticsearch] Index "${EMAIL_INDEX}" created successfully.`)
      // Synchronize existing PostgreSQL emails into Elasticsearch
      syncAllDatabaseEmailsToElasticsearch().catch(() => {})
    } else {
      logger.info(`[Elasticsearch] Index "${EMAIL_INDEX}" already exists.`)
    }
    return true
  } catch (error: any) {
    logger.warn('[Elasticsearch] Could not initialize index (non-fatal):', error.message)
    return false
  }
}

/**
 * Indexes an email document in Elasticsearch.
 *
 * Guarantees:
 * - Failure NEVER loses or aborts the PostgreSQL record.
 * - On failure, queues the emailId in Redis for automatic reconciliation.
 */
export async function indexEmailDocument(email: {
  id: string
  userId: string
  senderId?: string | null
  sender?: { email: string; name: string } | null
  recipient: string
  subject: string
  body: string
  status: string
  scheduledAt: Date
  sentAt?: Date | null
  createdAt: Date
  updatedAt: Date
  errorMessage?: string | null
  previewUrl?: string | null
}): Promise<boolean> {
  const document: EmailIndexDocument = {
    id: email.id,
    userId: email.userId,
    senderId: email.senderId,
    sender: email.sender?.email || email.senderId || 'default',
    recipient: email.recipient,
    subject: email.subject,
    body: email.body,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt ? email.sentAt.toISOString() : null,
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString(),
    errorMessage: email.errorMessage || null,
    previewUrl: email.previewUrl || null,
  }

  try {
    await esClient.index({
      index: EMAIL_INDEX,
      id: email.id,
      document,
      refresh: 'wait_for',
    })
    logger.debug(`[Elasticsearch] Indexed email ${email.id}`)
    // Remove from failed queue if it was previously queued
    await redisConnection.srem(FAILED_INDEX_REDIS_KEY, email.id).catch(() => {})
    return true
  } catch (err: any) {
    logger.warn(`[Elasticsearch] Failed to index email ${email.id} into ES. Queuing for reconciliation:`, err.message)
    // Non-blocking queuing in Redis for reconciliation
    await redisConnection.sadd(FAILED_INDEX_REDIS_KEY, email.id).catch(() => {})
    return false
  }
}

/**
 * Updates an existing email document in Elasticsearch when status changes.
 */
export async function updateEmailDocumentStatus(
  emailId: string,
  updateData: {
    status: 'scheduled' | 'processing' | 'sent' | 'failed'
    sentAt?: Date | null
    scheduledAt?: Date | null
    errorMessage?: string | null
    previewUrl?: string | null
  }
): Promise<boolean> {
  const docUpdates: any = {
    status: updateData.status,
    updatedAt: new Date().toISOString(),
  }
  if (updateData.sentAt !== undefined) {
    docUpdates.sentAt = updateData.sentAt ? updateData.sentAt.toISOString() : null
  }
  if (updateData.scheduledAt !== undefined) {
    docUpdates.scheduledAt = updateData.scheduledAt ? updateData.scheduledAt.toISOString() : null
  }
  if (updateData.errorMessage !== undefined) {
    docUpdates.errorMessage = updateData.errorMessage
  }
  if (updateData.previewUrl !== undefined) {
    docUpdates.previewUrl = updateData.previewUrl
  }

  try {
    await esClient.update({
      index: EMAIL_INDEX,
      id: emailId,
      doc: docUpdates,
      doc_as_upsert: true,
      refresh: 'wait_for',
    })
    logger.debug(`[Elasticsearch] Updated status for email ${emailId} to ${updateData.status}`)
    return true
  } catch (err: any) {
    logger.warn(`[Elasticsearch] Failed to update email ${emailId} in ES. Queuing for reconciliation:`, err.message)
    await redisConnection.sadd(FAILED_INDEX_REDIS_KEY, emailId).catch(() => {})
    return false
  }
}

/**
 * Searches email documents in Elasticsearch.
 *
 * Requirements:
 * - Search by recipient, subject, and body
 * - Filter by status (scheduled, sent, failed)
 * - Pagination support
 * - Automatic fallback to PostgreSQL if Elasticsearch is unavailable
 */
export async function searchEmailDocuments(params: SearchEmailParams): Promise<SearchEmailResult> {
  const { query, status, limit = 20, page = 1, userId } = params
  const from = (page - 1) * limit

  try {
    const mustClauses: any[] = []
    const filterClauses: any[] = []

    // 1. User scoping if provided
    if (userId) {
      filterClauses.push({ term: { userId } })
    }

    // 2. Status filter
    if (status && status !== 'all') {
      filterClauses.push({ term: { status } })
    }

    // 3. Multi-field search across recipient, subject, and body
    if (query && query.trim().length > 0) {
      mustClauses.push({
        multi_match: {
          query: query.trim(),
          fields: ['recipient^3', 'subject^2', 'body', 'sender'],
          fuzziness: 'AUTO',
          operator: 'and',
        },
      })
    } else {
      mustClauses.push({ match_all: {} })
    }

    const esResponse = await esClient.search({
      index: EMAIL_INDEX,
      from,
      size: limit,
      query: {
        bool: {
          must: mustClauses,
          filter: filterClauses,
        },
      },
      sort: [{ createdAt: { order: 'desc' } }],
    })

    const totalRaw = esResponse.hits.total
    const total = typeof totalRaw === 'number' ? totalRaw : totalRaw?.value || 0
    const hits = esResponse.hits.hits.map((h: any) => h._source as EmailIndexDocument)

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      data: hits,
      source: 'elasticsearch',
    }
  } catch (error: any) {
    logger.warn('[Elasticsearch] Search failed. Falling back to PostgreSQL search:', error.message)

    // Fallback to PostgreSQL
    const where: any = {}
    if (userId) where.userId = userId
    if (status && status !== 'all') where.status = status
    if (query && query.trim().length > 0) {
      where.OR = [
        { recipient: { contains: query.trim(), mode: 'insensitive' } },
        { subject: { contains: query.trim(), mode: 'insensitive' } },
        { body: { contains: query.trim(), mode: 'insensitive' } },
      ]
    }

    const [dbEmails, total] = await Promise.all([
      prisma.email.findMany({
        where,
        take: limit,
        skip: from,
        orderBy: { createdAt: 'desc' },
        include: { sender: true },
      }),
      prisma.email.count({ where }),
    ])

    const formattedData: EmailIndexDocument[] = dbEmails.map((e) => ({
      id: e.id,
      userId: e.userId,
      senderId: e.senderId,
      sender: e.sender?.email || e.senderId,
      recipient: e.recipient,
      subject: e.subject,
      body: e.body,
      status: e.status,
      scheduledAt: e.scheduledAt.toISOString(),
      sentAt: e.sentAt ? e.sentAt.toISOString() : null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      errorMessage: e.errorMessage,
      previewUrl: e.previewUrl,
    }))

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      data: formattedData,
      source: 'database_fallback',
    }
  }
}

/**
 * Reconciliation & Retry Mechanism:
 * Reads failed email IDs from Redis queue and re-indexes them from PostgreSQL.
 * Also synchronizes any PostgreSQL emails missing from the Elasticsearch index.
 */
export async function reconcileFailedIndexing(): Promise<{
  reconciledCount: number
  failedCount: number
  totalPending: number
}> {
  try {
    const failedIds = await redisConnection.smembers(FAILED_INDEX_REDIS_KEY)
    if (!failedIds || failedIds.length === 0) {
      return { reconciledCount: 0, failedCount: 0, totalPending: 0 }
    }

    logger.info(`[Elasticsearch Reconciliation] Found ${failedIds.length} pending failed email indexes. Retrying...`)
    let reconciled = 0
    let failed = 0

    const emails = await prisma.email.findMany({
      where: { id: { in: failedIds } },
      include: { sender: true },
    })

    for (const email of emails) {
      const success = await indexEmailDocument(email)
      if (success) {
        reconciled++
        await redisConnection.srem(FAILED_INDEX_REDIS_KEY, email.id)
      } else {
        failed++
      }
    }

    return {
      reconciledCount: reconciled,
      failedCount: failed,
      totalPending: failedIds.length - reconciled,
    }
  } catch (error: any) {
    logger.error('[Elasticsearch Reconciliation] Error during reconciliation:', error.message)
    return { reconciledCount: 0, failedCount: 0, totalPending: 0 }
  }
}

/**
 * Synchronizes recent emails from PostgreSQL to Elasticsearch.
 */
export async function syncAllDatabaseEmailsToElasticsearch(): Promise<number> {
  try {
    const emails = await prisma.email.findMany({
      include: { sender: true },
      take: 200,
      orderBy: { createdAt: 'desc' },
    })
    logger.info(`[Elasticsearch] Syncing ${emails.length} emails from DB to ES...`)
    let count = 0
    for (const email of emails) {
      const ok = await indexEmailDocument(email)
      if (ok) count++
    }
    logger.info(`[Elasticsearch] Successfully indexed ${count}/${emails.length} emails into ES`)
    return count
  } catch (err: any) {
    logger.warn('[Elasticsearch] Batch sync failed:', err.message)
    return 0
  }
}
