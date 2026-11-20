import crypto from 'crypto'
import { env } from '../config/env'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

/**
 * Derives a 32-byte key from the secret key using SHA-256
 */
function getEncryptionKey(): Buffer {
  const secret = env.ENCRYPTION_KEY || env.SESSION_SECRET || 'default-secret-key-at-least-32-chars-long'
  return crypto.createHash('sha256').update(secret).digest()
}

/**
 * Encrypts a sensitive string value into a base64 encoded payload: iv:tag:ciphertext
 */
export function encrypt(text: string): string {
  if (!text) return text
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = getEncryptionKey()
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()

  // Format: iv:tag:ciphertext (all in hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`
}

/**
 * Decrypts a previously encrypted base64/hex payload back to the plain text
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return encryptedText

  const parts = encryptedText.split(':')
  if (parts.length !== 3) {
    // If not in encrypted format (e.g. legacy plain text), return as-is
    return encryptedText
  }

  const [ivHex, tagHex, encryptedHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const key = getEncryptionKey()

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

