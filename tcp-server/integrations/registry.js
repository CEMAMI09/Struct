const { execute } = require('./adapters')
const { validateConfig, validateCredentials, fail } = require('./config')
// One adapter contract; shared scheduling/leases live in outbox.js and PostgreSQL.
const capabilities = Object.freeze({
  http: {
    transport: 'HTTPS POST',
    authentication: 'HMAC-SHA256; optional bearer token',
    verification: 'configuration only',
    acceptance: 'HTTP 2xx',
    nativeBatching: false,
  },
  aws_sqs: {
    transport: 'AWS SDK v3 HTTPS',
    authentication: 'Explicit access key; optional session token',
    verification: 'GetQueueAttributes',
    acceptance: 'MessageId returned',
    nativeBatching: false,
  },
  aws_eventbridge: {
    transport: 'AWS SDK v3 HTTPS',
    authentication: 'Explicit access key; optional session token',
    verification: 'DescribeEventBus',
    acceptance: 'Individual PutEvents entry accepted',
    nativeBatching: false,
  },
  azure_service_bus: {
    transport: 'HTTPS REST',
    authentication: 'Entity-scoped SAS',
    verification: 'configuration only',
    acceptance: 'Service Bus accepted HTTP response',
    nativeBatching: false,
  },
  google_pubsub: {
    transport: 'HTTPS REST',
    authentication: 'Service account RSA JWT/OAuth',
    verification: 'Topic lookup',
    acceptance: 'messageIds returned',
    nativeBatching: false,
  },
  postgresql: {
    transport: 'Verified TLS PostgreSQL',
    authentication: 'Username/password; optional CA',
    verification: 'Read-only privileges/columns/unique-key check',
    acceptance: 'Insert committed or existing event_id',
    nativeBatching: false,
  },
})
function getAdapter(kind) {
  if (!Object.hasOwn(capabilities, kind)) fail('Unknown integration adapter')
  return Object.freeze({
    kind,
    capabilities: capabilities[kind],
    validateConfiguration: (input) => validateConfig(kind, input),
    validateCredentials: (input) => validateCredentials(kind, input),
    verify: (snapshot, secrets, options = {}) =>
      execute(
        { ...snapshot, kind },
        secrets,
        {},
        {},
        { ...options, mode: 'verify' },
      ),
    deliver: (snapshot, secrets, body, job, options = {}) =>
      execute({ ...snapshot, kind }, secrets, body, job, options),
  })
}
module.exports = { getAdapter, capabilities }
