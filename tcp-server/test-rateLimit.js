/**
 * Per-API-key rate limiter smoke test.
 * Run: node test-rateLimit.js
 */

const assert = require('assert')
const { checkRateLimit, resetRateLimits, BURST } = require('./rateLimit')

resetRateLimits()

const key = 'abcdefghijklmnop'

for (let i = 0; i < BURST; i++) {
  const r = checkRateLimit(key)
  assert.strictEqual(r.allowed, true, `token ${i + 1} should be allowed`)
}

const blocked = checkRateLimit(key)
assert.strictEqual(blocked.allowed, false)
assert.ok(blocked.retryAfterMs > 0)

const other = checkRateLimit('otherkey00000001')
assert.strictEqual(other.allowed, true)

console.log('[test-rateLimit] ok — burst exhausted then blocked')
