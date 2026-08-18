import crypto from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12

function credentialKey() {
  const raw = process.env.TCP_CREDENTIAL_KEY || process.env.NUXT_TCP_CREDENTIAL_KEY || ''
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw createError({
      statusCode: 500,
      message: 'TCP_CREDENTIAL_KEY is not configured (64-char hex)',
    })
  }
  return Buffer.from(raw, 'hex')
}

export function randomKeyId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let key = ''
  for (let i = 0; i < 16; i++) {
    key += alphabet[bytes[i]! % alphabet.length]
  }
  return key
}

export function randomApiSecret() {
  return crypto.randomBytes(32).toString('hex')
}

export function encryptApiSecret(secret: string) {
  const key = credentialKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('hex')}:${ciphertext.toString('hex')}:${tag.toString('hex')}`
}

/** Decrypt a fleet / device API secret stored as v1:iv:ct:tag hex blob. */
export function decryptApiSecret(blob: string) {
  if (!blob || typeof blob !== 'string') {
    throw new Error('Missing encrypted API secret')
  }
  const parts = blob.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported API secret ciphertext format')
  }
  const key = credentialKey()
  const iv = Buffer.from(parts[1]!, 'hex')
  const ciphertext = Buffer.from(parts[2]!, 'hex')
  const tag = Buffer.from(parts[3]!, 'hex')
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function secretPreview(secret: string) {
  return secret.length > 4 ? secret.slice(-4) : secret
}

export interface DeviceCredentialBundle {
  keyId: string
  apiSecret: string
  apiSecretEncrypted: string
  apiSecretPreview: string
}

export function createDeviceCredentials(): DeviceCredentialBundle {
  const keyId = randomKeyId()
  const apiSecret = randomApiSecret()
  return {
    keyId,
    apiSecret,
    apiSecretEncrypted: encryptApiSecret(apiSecret),
    apiSecretPreview: secretPreview(apiSecret),
  }
}

export function sanitizeDeviceForClient<T extends Record<string, unknown>>(device: T) {
  const copy = { ...device }
  delete copy.api_secret_encrypted
  return copy
}
