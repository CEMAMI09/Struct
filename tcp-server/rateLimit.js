/**
 * Per-API-key token-bucket rate limiter for the TCP ingestion path.
 *
 * Defaults (override with env):
 *   TCP_RATE_LIMIT_PER_SEC  — refill rate (tokens/sec), default 30
 *   TCP_RATE_LIMIT_BURST    — bucket capacity, default 60
 */

const RATE_PER_SEC = Number(process.env.TCP_RATE_LIMIT_PER_SEC || 30)
const BURST = Number(process.env.TCP_RATE_LIMIT_BURST || 60)

/** @type {Map<string, { tokens: number, updatedAt: number }>} */
const buckets = new Map()

/**
 * @param {string} apiKey
 * @returns {{ allowed: boolean, retryAfterMs: number }}
 */
function checkRateLimit(apiKey) {
  const now = Date.now()
  let bucket = buckets.get(apiKey)

  if (!bucket) {
    bucket = { tokens: BURST - 1, updatedAt: now }
    buckets.set(apiKey, bucket)
    return { allowed: true, retryAfterMs: 0 }
  }

  const elapsedSec = (now - bucket.updatedAt) / 1000
  bucket.tokens = Math.min(BURST, bucket.tokens + elapsedSec * RATE_PER_SEC)
  bucket.updatedAt = now

  if (bucket.tokens < 1) {
    const need = 1 - bucket.tokens
    const retryAfterMs = Math.ceil((need / RATE_PER_SEC) * 1000)
    return { allowed: false, retryAfterMs }
  }

  bucket.tokens -= 1
  return { allowed: true, retryAfterMs: 0 }
}

/** Test helper — clear all buckets. */
function resetRateLimits() {
  buckets.clear()
}

module.exports = {
  checkRateLimit,
  resetRateLimits,
  RATE_PER_SEC,
  BURST,
}
