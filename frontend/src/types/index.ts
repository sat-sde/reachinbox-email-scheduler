// ----- Auth -----
export interface User {
  id: string
  name: string
  email: string
  avatar?: string | null
  googleId?: string | null
  createdAt: string
}

export interface AuthResponse {
  success: boolean
  user: User
}

// ----- Email -----
export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed'

export interface Email {
  id: string
  userId: string
  senderId?: string | null
  recipient: string
  subject: string
  body: string
  status: EmailStatus
  scheduledAt: string
  sentAt?: string | null
  errorMessage?: string | null
  previewUrl?: string | null
  messageId?: string | null
  bullJobId?: string | null
  idempotencyKey?: string | null
  createdAt: string
  updatedAt: string
}

// ----- Sender -----
export interface Sender {
  id: string
  userId: string
  email: string
  name: string
  hourlyLimit: number
  enabled: boolean
  createdAt: string
}

// ----- Scheduler / Jobs -----
export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused'

export interface ScheduledJob {
  id: string
  name: string
  emailId: string
  status: JobStatus
  delay?: number
  cron?: string
  createdAt: string
}

// ----- API Responses -----
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ApiError {
  success: boolean
  message: string
  errors?: unknown
}
