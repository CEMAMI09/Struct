/**
 * Replay protection for ChaCha20-encrypted uplinks.
 *
 * Ciphertext plaintext layout:
 *   [4-byte uint32 LE unix timestamp][packed schema struct…]
 *
 * Rejects packets whose timestamp is outside the skew window, and rejects
 * duplicate (deviceId, nonce) pairs seen within that window.
 */

const TIMESTAMP_LEN = 4
const DEFAULT_SKEW_SEC = Number(process.env.TCP_REPLAY_SKEW_SEC || 60)

/** @type {Map<string, Map<string, number>>} deviceId → (nonceHex → expiresAtMs) */
const seenNonces = new Map()

/**
 * Peel + validate timestamp from decrypted plaintext.
 * @param {Buffer} plaintext
 * @param {number} [nowSec]
 * @param {number} [skewSec]
 * @returns {{ timestamp: number, payload: Buffer }}
 */
function stripAndValidateTimestamp(plaintext, nowSec = Math.floor(Date.now() / 1000), skewSec = DEFAULT_SKEW_SEC) {
  if (plaintext.length < TIMESTAMP_LEN) {
    throw new Error(`Encrypted plaintext too short for timestamp (${plaintext.length}B)`)
  }

  const timestamp = plaintext.readUInt32LE(0)
  const skew = Math.abs(nowSec - timestamp)
  if (skew > skewSec) {
    throw new Error(
      `Replay / clock skew: timestamp=${timestamp}, now=${nowSec}, skew=${skew}s (max ${skewSec}s)`,
    )
  }

  return {
    timestamp,
    payload: plaintext.subarray(TIMESTAMP_LEN),
  }
}

/**
 * Prepend a unix-seconds timestamp for device simulators / tests.
 * @param {Buffer} packedStruct
 * @param {number} [timestampSec]
 */
function prependTimestamp(packedStruct, timestampSec = Math.floor(Date.now() / 1000)) {
  const out = Buffer.alloc(TIMESTAMP_LEN + packedStruct.length)
  out.writeUInt32LE(timestampSec >>> 0, 0)
  packedStruct.copy(out, TIMESTAMP_LEN)
  return out
}

/**
 * Record a nonce; throws if it was recently seen for this device.
 * @param {string} deviceId
 * @param {Buffer} nonce
 * @param {number} [skewSec]
 */
function rememberNonce(deviceId, nonce, skewSec = DEFAULT_SKEW_SEC) {
  const key = nonce.toString('hex')
  const now = Date.now()
  const ttlMs = skewSec * 1000

  let map = seenNonces.get(deviceId)
  if (!map) {
    map = new Map()
    seenNonces.set(deviceId, map)
  }

  // Opportunistic prune
  for (const [n, exp] of map) {
    if (exp <= now) map.delete(n)
  }

  const existing = map.get(key)
  if (existing && existing > now) {
    throw new Error('Replay detected: duplicate ChaCha20 nonce')
  }

  map.set(key, now + ttlMs)
}

/** Test helper */
function resetReplayCache() {
  seenNonces.clear()
}

module.exports = {
  TIMESTAMP_LEN,
  DEFAULT_SKEW_SEC,
  stripAndValidateTimestamp,
  prependTimestamp,
  rememberNonce,
  resetReplayCache,
}
