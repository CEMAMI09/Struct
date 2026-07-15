/**
 * Logical webhook routing smoke test.
 * Run: node test-webhooks.js
 */

const assert = require('assert')
const { matchesRoutingRule } = require('./webhooks')

const payload = {
  temperature: 120,
  humidity: 45.5,
  active: true,
  status: 'alarm',
}

assert.strictEqual(matchesRoutingRule(payload, null), true)
assert.strictEqual(
  matchesRoutingRule(payload, { key: 'temperature', operator: '>', value: 100 }),
  true,
)
assert.strictEqual(
  matchesRoutingRule(payload, { key: 'temperature', operator: '<=', value: 100 }),
  false,
)
assert.strictEqual(
  matchesRoutingRule(payload, { key: 'humidity', operator: '>=', value: 45.5 }),
  true,
)
assert.strictEqual(
  matchesRoutingRule(payload, { key: 'active', operator: '==', value: true }),
  true,
)
assert.strictEqual(
  matchesRoutingRule(payload, { key: 'status', operator: '!=', value: 'ok' }),
  true,
)
assert.strictEqual(
  matchesRoutingRule(payload, { key: 'missing', operator: '>', value: 0 }),
  false,
)
assert.strictEqual(
  matchesRoutingRule(payload, { key: 'temperature', operator: 'invalid', value: 0 }),
  false,
)
assert.strictEqual(matchesRoutingRule(payload, {}), false)

console.log('[test-webhooks] ok — logical routing rules evaluated')
