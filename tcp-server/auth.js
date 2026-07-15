/**
 * Protocol v2 credential encryption for gateway-side HMAC verification.
 */
const crypto = require('crypto')

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function credentialKey() {
  const raw = process.env.TCP_CREDENTIAL_KEY || ''
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('TCP_CREDENTIAL_KEY must be a 64-char hex string (32 bytes)')
  }
  return Buffer.from(raw, 'hex')
}

function encryptSecret(secret) {
  const key = credentialKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('hex')}:${ciphertext.toString('hex')}:${tag.toString('hex')}`
}

function decryptSecret(blob) {
  if (!blob || typeof blob !== 'string') {
    throw new Error('Missing encrypted API secret')
  }
  const parts = blob.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported API secret ciphertext format')
  }
  const key = credentialKey()
  const iv = Buffer.from(parts[1], 'hex')
  const ciphertext = Buffer.from(parts[2], 'hex')
  const tag = Buffer.from(parts[3], 'hex')
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function frameMac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest()
}

function verifyFrameMac(secret, body, mac) {
  if (!mac || mac.length !== 32) return false
  const expected = frameMac(secret, body)
  return crypto.timingSafeEqual(expected, mac)
}

module.exports = {
  encryptSecret,
  decryptSecret,
  frameMac,
  verifyFrameMac,
}
