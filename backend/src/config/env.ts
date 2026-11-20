import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),

  // Database (PostgreSQL via Prisma)
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis (BullMQ persistent queue storage & distributed rate limiting)
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // BullMQ Worker & Rate Limiting Concurrency
  WORKER_CONCURRENCY: z.coerce.number().min(1).max(50).default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().min(0).default(2000), // Min delay between sends per sender
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().min(1).default(50), // Max emails per hour per sender

  // Elasticsearch
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),

  // Security & Encryption
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars').default('reachinbox-dev-jwt-secret-key-32-chars-minimum'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars').default('reachinbox-dev-session-secret-key-32-chars'),
  ENCRYPTION_KEY: z.string().optional().default('reachinbox-secure-credential-key-32-bytes!'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/auth/google/callback'),

  // Slack OAuth
  SLACK_CLIENT_ID: z.string().optional().default(''),
  SLACK_CLIENT_SECRET: z.string().optional().default(''),
  SLACK_CALLBACK_URL: z.string().default('http://localhost:4000/api/slack/callback'),

  // Ethereal / SMTP
  SMTP_HOST: z.string().default('smtp.ethereal.email'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().default('noreply@reachinbox.example.com'),

  // Frontend URL (CORS)
  FRONTEND_URL: z.string().default('http://localhost:5173'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
