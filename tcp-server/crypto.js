/**
 * ChaCha20-Poly1305 helpers for edge payload encryption.
 *
 * Wire (after 16-byte API key + 1-byte schema version):
 *   [12-byte nonce][ciphertext…][16-byte auth tag]
 *
 * Ciphertext plaintext:
 *   [4-byte uint32 LE unix timestamp][packed schema struct…]
 *
 * Ciphertext length == TIMESTAMP_LEN + schema byte size.
 */

const crypto = require('crypto')

const NONCE_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

function hexToKey(hex) {
  if (!hex || typeof hex !== 'string') {
    throw new Error('Missing encryption_key')
  }
  const clean = hex.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error('encryption_key must be 64 hex chars (32 bytes)')
  }
  return Buffer.from(clean, 'hex')
}

/**
 * Decrypt payload region (everything after API key).
 * @param {Buffer} encryptedRegion
 * @param {string} keyHex
 * @returns {Buffer} plaintext packed struct
 */
function splitEncryptedRegion(encryptedRegion) {
  if (encryptedRegion.length < NONCE_LEN + TAG_LEN) {
    throw new Error(
      `Encrypted payload too short: ${encryptedRegion.length}B (need ≥ ${NONCE_LEN + TAG_LEN})`,
    )
  }
  return {
    nonce: encryptedRegion.subarray(0, NONCE_LEN),
    tag: encryptedRegion.subarray(encryptedRegion.length - TAG_LEN),
    ciphertext: encryptedRegion.subarray(NONCE_LEN, encryptedRegion.length - TAG_LEN),
  }
}

function decryptPayload(encryptedRegion, keyHex) {
  const { nonce, tag, ciphertext } = splitEncryptedRegion(encryptedRegion)
  const key = hexToKey(keyHex)

  const decipher = crypto.createDecipheriv('chacha20-poly1305', key, nonce, {
    authTagLength: TAG_LEN,
  })
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * Encrypt plaintext for tests / simulators.
 * @param {Buffer} plaintext
 * @param {string} keyHex
 * @param {Buffer} [nonce]
 */
function encryptPayload(plaintext, keyHex, nonce) {
  const key = hexToKey(keyHex)
  const n = nonce && nonce.length === NONCE_LEN ? nonce : crypto.randomBytes(NONCE_LEN)
  const cipher = crypto.createCipheriv('chacha20-poly1305', key, n, {
    authTagLength: TAG_LEN,
  })
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([n, ciphertext, tag])
}

function encryptedFrameLength(plainLen) {
  return NONCE_LEN + plainLen + TAG_LEN
}

module.exports = {
  NONCE_LEN,
  TAG_LEN,
  KEY_LEN,
  decryptPayload,
  encryptPayload,
  encryptedFrameLength,
  hexToKey,
  splitEncryptedRegion,
}
