/**
 * IP + API-key rate limiter smoke test.
 * Run: node test-rateLimit.js
 */

const assert = require('assert')
const {
  checkIpConnection,
  checkPayloadRateLimit,
  resetRateLimits,
  IP_CONN_LIMIT,
  PAYLOAD_LIMIT,
} = require('./rateLimit')

resetRateLimits()

const ip = '203.0.113.50'
for (let i = 0; i < IP_CONN_LIMIT; i++) {
  const r = checkIpConnection(ip)
  assert.strictEqual(r.allowed, true, `IP conn ${i + 1} should be allowed`)
}
const blockedIp = checkIpConnection(ip)
assert.strictEqual(blockedIp.allowed, false, '11th IP conn in 1s should be blocked')

const otherIp = checkIpConnection('203.0.113.51')
assert.strictEqual(otherIp.allowed, true, 'other IP should be independent')

resetRateLimits()

const key = 'abcdefghijklmnop'
for (let i = 0; i < PAYLOAD_LIMIT; i++) {
  const r = checkPayloadRateLimit(key)
  assert.strictEqual(r.allowed, true, `payload ${i + 1} should be allowed`)
}

const blockedPayload = checkPayloadRateLimit(key)
assert.strictEqual(blockedPayload.allowed, false)
assert.ok(blockedPayload.retryAfterMs > 0)

const otherKey = checkPayloadRateLimit('otherkey00000001')
assert.strictEqual(otherKey.allowed, true)

console.log('[test-rateLimit] ok — IP conn + payload limits enforced')
