const assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  fs = require('node:fs')
const core = require('../../tcp-server/integrations'),
  { providerError } = require('../../tcp-server/integrations/adapters'),
  {
    isPublicAddress,
    validateWebhookUrl,
    publicLookup,
  } = require('../../tcp-server/safeWebhook')
process.env.STRUCT_INTEGRATION_KEY = '56'.repeat(32)
let passed = 0
const check = (fn) => {
  fn()
  passed++
}
const s = { password: 'test-only' },
  blob = core.seal(s, 'org-a', 'destination-a')
check(() => assert.deepEqual(core.open(blob, 'org-a', 'destination-a'), s))
for (const [b, o, d] of [
  [blob, 'org-b', 'destination-a'],
  [blob, 'org-a', 'destination-b'],
  [
    blob.slice(0, -2) +
      (parseInt(blob.slice(-2), 16) ^ 255).toString(16).padStart(2, '0'),
    'org-a',
    'destination-a',
  ],
])
  check(() => assert.throws(() => core.open(b, o, d)))
for (const address of [
  '127.0.0.1',
  '::1',
  '169.254.169.254',
  '10.1.2.3',
  '192.168.1.2',
  '::ffff:127.0.0.1',
  '0.0.0.0',
  '100.64.1.1',
  'fe80::1',
])
  check(() => assert.equal(isPublicAddress(address), false))
for (const url of [
  'http://example.com',
  'https://u:p@example.com',
  'https://localhost',
  'https://169.254.169.254',
])
  check(() => assert.throws(() => validateWebhookUrl(url)))
for (const [kind, config] of [
  [
    'aws_sqs',
    { region: 'us-east-1', queueUrl: 'https://evil.example/123456789012/foo' },
  ],
  [
    'aws_sqs',
    {
      region: 'us-east-1',
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/a?secret=foo',
    },
  ],
  ['postgresql', { host: '127.0.0.1', database: 'a', table: 't' }],
  [
    'postgresql',
    { host: 'db.example.com', database: 'a', table: 'x;drop table x' },
  ],
  ['http', { url: 'https://example.com?token=foo' }],
  ['http', { url: 'https://example.com', headers: { authorization: 'foo' } }],
  ['azure_service_bus', { namespace: 'x.evil.com', entity: 'a' }],
  ['google_pubsub', { project: 'project-a', topic: 'a/../../foo' }],
])
  check(() => assert.throws(() => core.validateConfig(kind, config)))
for (const route of [
  { all: [] },
  { field: 'payload.__proto__.x', op: 'exists' },
  { field: 'payload.x', op: 'eval', value: 1 },
  { field: 'payload.x', op: 'gt', value: Number.MAX_SAFE_INTEGER + 1 },
])
  check(() => assert.throws(() => core.validateRoute(route)))
let route = { field: 'payload.x', op: 'eq', value: true }
for (let n = 0; n < 7; n++) route = { all: [route] }
check(() => assert.throws(() => core.validateRoute(route)))
check(() =>
  assert.deepEqual(
    core.validateRoute({
      any: [
        { field: 'payload.x', op: 'gt', value: '9007199254740993' },
        { field: 'device_id', op: 'eq', value: 'device-a' },
      ],
    }).any[0].value,
    '9007199254740993',
  ),
)
const body = {
  id: crypto.randomUUID(),
  device_id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  payload: {
    count: '18446744073709551615',
    temp: 1.0000000000000002,
    enabled: true,
    nested: { value: 42 },
  },
}
const snap = {
  mapping: core.validateMapping(null),
  schema_slot: 0,
  schema_version: 1,
}
check(() =>
  assert.equal(core.transform(body, snap).value.data.count, body.payload.count),
)
check(() =>
  assert.equal(core.transform(body, snap).value.data.temp, body.payload.temp),
)
check(() =>
  assert.equal(
    core.transform(body, {
      mapping: {
        format: 'flat-v1',
        fields: [{ from: 'nested.value', to: 'reading' }],
        metadata: [],
      },
    }).value.reading,
    42,
  ),
)
check(() =>
  assert.throws(() =>
    core.transform(body, {
      mapping: {
        format: 'envelope-v1',
        fields: [{ from: 'missing', to: 'x' }],
        metadata: [],
      },
    }),
  ),
)
check(() =>
  assert.throws(() =>
    core.validateMapping({
      format: 'flat-v1',
      fields: [{ from: 'count', to: 'event_id' }],
      metadata: [],
    }),
  ),
)
check(() =>
  assert.throws(() =>
    core.validateMapping({
      format: 'flat-v1',
      fields: [{ from: 'count', to: 'number', convert: 'float32' }],
      metadata: [],
    }),
  ),
)
check(() =>
  assert.throws(() =>
    core.transform({ ...body, payload: { value: 'x'.repeat(240001) } }, snap),
  ),
)
for (const [err, outcome] of [
  [{ name: 'AccessDeniedException' }, 'dead'],
  [{ name: 'ThrottlingException' }, 'retry'],
  [{ name: 'error', code: '23505' }, 'dead'],
  [{ code: 'ETIMEDOUT' }, 'retry'],
  [{ code: 'WEBHOOK_POLICY' }, 'dead'],
])
  check(() => assert.equal(providerError(err).outcome, outcome))
;(async () => {
  const dns = require('node:dns'),
    original = dns.lookup
  try {
    dns.lookup = (_h, _o, cb) =>
      cb(null, [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ])
    await new Promise((resolve) =>
      publicLookup('rebind.example', { all: false }, (err) => {
        check(() => assert.equal(err.code, 'WEBHOOK_POLICY'))
        resolve()
      }),
    )
  } finally {
    dns.lookup = original
  }
  fs.mkdirSync('docs/phase-7/evidence', { recursive: true })
  fs.writeFileSync(
    'docs/phase-7/evidence/core.json',
    JSON.stringify(
      { passed, timestamp: new Date().toISOString(), node: process.version },
      null,
      2,
    ),
  )
  console.log(
    `PASS ${passed} integration validation, transformation and security checks`,
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
