const crypto = require('node:crypto')
const https = require('node:https')
const { Transform } = require('node:stream')
const tls = require('node:tls')
const { promisify } = require('node:util')
const {
  SQSClient,
  SendMessageCommand,
  GetQueueAttributesCommand,
} = require('@aws-sdk/client-sqs')
const {
  EventBridgeClient,
  PutEventsCommand,
  DescribeEventBusCommand,
} = require('@aws-sdk/client-eventbridge')
const { NodeHttpHandler } = require('@smithy/node-http-handler')
const { Pool } = require('pg')
const { publicLookup, postWebhook } = require('../safeWebhook')
const { signWebhookBody } = require('../webhooks')
const {
  classifyResponse,
  classifyError,
  retryAfter,
} = require('../delivery-policy')
const { request, parse } = require('./transport')
const {
  fail,
  validateConfig,
  validateCredentials,
  identifier,
} = require('./config')
const { transform } = require('./transform')
const accepted = (detail, receipt = null) => ({
  outcome: 'delivered',
  category: null,
  detail,
  providerReceipt:
    typeof receipt === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(receipt)
      ? receipt
      : null,
})
function providerError(error) {
  const name = String(error?.name || '') + ' ' + String(error?.code || '')
  if (
    /Throttl|LimitExceeded|ServiceUnavailable|Internal|Timeout|ExpiredToken|RequestTimeout/i.test(
      name,
    )
  )
    return {
      outcome: 'retry',
      category: 'http_transient',
      detail: 'Provider temporarily unavailable, throttled or token expired',
    }
  if (error?.code === 'INTEGRATION_CONFIG')
    return {
      outcome: 'dead',
      category: 'configuration',
      detail:
        'Integration configuration, credentials or field mapping is invalid; check required fields and output limits',
    }
  if (error?.$metadata?.httpStatusCode) {
    const r = classifyResponse(error.$metadata.httpStatusCode)
    return {
      ...r,
      detail: `Provider request ${r.outcome === 'retry' ? 'temporarily failed' : 'rejected'} (HTTP ${error.$metadata.httpStatusCode})`,
    }
  }
  if (
    /\b(28|42|22|23)[A-Z0-9]{3}\b/.test(name) ||
    /AccessDenied|Unauthorized|NotFound|Invalid|Permission|Signature|Authentication/i.test(
      name,
    )
  )
    return {
      outcome: 'dead',
      category: 'configuration',
      detail:
        'Provider credentials, permissions, resource or message configuration rejected',
    }
  return classifyError(error)
}
function awsClient(kind, c, s, dependencies) {
  if (dependencies.awsFactory) return dependencies.awsFactory(kind, c, s)
  const handler = new NodeHttpHandler({
    httpsAgent: new https.Agent({ lookup: publicLookup, keepAlive: false }),
    connectionTimeout: 3000,
    requestTimeout: 8000,
  })
  const handle = handler.handle.bind(handler)
  handler.handle = async (...args) => {
    const result = await handle(...args)
    const source = result.response.body
    let size = 0
    const bounded = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length
        callback(
          size > 65536
            ? Object.assign(new Error('Provider response exceeds limit'), {
                code: 'INTEGRATION_CONFIG',
              })
            : null,
          chunk,
        )
      },
    })
    source.on('error', (e) => bounded.destroy(e))
    bounded.on('error', () => source.destroy())
    result.response.body = source.pipe(bounded)
    return result
  }
  return new (kind === 'aws_sqs' ? SQSClient : EventBridgeClient)({
    region: c.region,
    credentials: s,
    maxAttempts: 1,
    requestHandler: handler,
    endpoint: `https://${kind === 'aws_sqs' ? 'sqs' : 'events'}.${c.region}.amazonaws.com`,
    useFipsEndpoint: false,
    useDualstackEndpoint: false,
  })
}
function azureAuth(c, s) {
  const resource = `https://${c.namespace}.servicebus.windows.net/${c.entity}`
  const expiry = Math.floor(Date.now() / 1000) + 300,
    encoded = encodeURIComponent(resource)
  const sig = crypto
    .createHmac('sha256', s.key)
    .update(`${encoded}\n${expiry}`)
    .digest('base64')
  return `SharedAccessSignature sr=${encoded}&sig=${encodeURIComponent(sig)}&se=${expiry}&skn=${encodeURIComponent(s.keyName)}`
}
async function googleToken(s, send, signal) {
  const now = Math.floor(Date.now() / 1000),
    b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const claims = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: s.clientEmail, scope: 'https://www.googleapis.com/auth/pubsub', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 300 })}`
  const assertion = `${claims}.${crypto.sign('RSA-SHA256', Buffer.from(claims), s.privateKey).toString('base64url')}`
  const response = await send('https://oauth2.googleapis.com/token', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    signal,
  })
  if (response.status !== 200)
    throw Object.assign(new Error('Google authentication rejected'), {
      $metadata: { httpStatusCode: response.status },
    })
  const token = parse(response).access_token
  if (
    typeof token !== 'string' ||
    !token.length ||
    token.length > 8192 ||
    /[\r\n]/.test(token)
  )
    fail('Invalid Google token response')
  return token
}
const pools = new Map()
async function pgPool(c, s, dependencies) {
  if (dependencies.pgFactory) return dependencies.pgFactory(c, s)
  // Resolve on each dispatch, reject ALL private answers, then connect to the pinned
  // IP while verifying the certificate against the original hostname.
  const address = await Promise.race([
    promisify(publicLookup)(c.host, { all: false }),
    new Promise((_, reject) => {
      const t = setTimeout(
        () =>
          reject(
            Object.assign(new Error('DNS timeout'), { code: 'ETIMEDOUT' }),
          ),
        3000,
      )
      t.unref()
    }),
  ])
  const key = crypto
    .createHash('sha256')
    .update(JSON.stringify([c, s, address]))
    .digest('hex')
  if (pools.has(key)) {
    const p = pools.get(key)
    p.touched = Date.now()
    return p.pool
  }
  if (pools.size >= 32) {
    const [old, entry] = [...pools].sort(
      (a, b) => a[1].touched - b[1].touched,
    )[0]
    pools.delete(old)
    void entry.pool.end().catch(() => {})
  }
  const pool = new Pool({
    host: address,
    port: c.port,
    database: c.database,
    user: s.user,
    password: s.password,
    ssl: {
      rejectUnauthorized: true,
      servername: c.host,
      ...(s.ca ? { ca: s.ca } : {}),
      checkServerIdentity: (_host, cert) =>
        tls.checkServerIdentity(c.host, cert),
    },
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 6000,
    application_name: 'struct-delivery',
  })
  pool.on('error', () => {}) // Errors are surfaced by the job; never log provider messages.
  pools.set(key, { pool, touched: Date.now() })
  return pool
}
async function closePools() {
  await Promise.all([...pools.values()].map((p) => p.pool.end()))
  pools.clear()
}
async function execute(
  snapshot,
  secrets,
  body,
  job,
  { mode = 'deliver', dependencies = {} } = {},
) {
  const kind = snapshot.kind,
    c = validateConfig(kind, snapshot.config),
    s = validateCredentials(kind, secrets),
    send = dependencies.request || request,
    signal = AbortSignal.timeout(8000)
  if (mode === 'verify' && kind === 'http')
    return {
      level: 'configuration_valid',
      detail:
        'HTTPS URL and credentials validated. No request sent; use explicit test send to verify acceptance.',
    }
  const output = mode === 'verify' ? null : transform(body, snapshot)
  try {
    if (kind.startsWith('aws_')) {
      const client = awsClient(kind, c, s, dependencies)
      try {
        if (mode === 'verify') {
          await client.send(
            kind === 'aws_sqs'
              ? new GetQueueAttributesCommand({
                  QueueUrl: c.queueUrl,
                  AttributeNames: ['QueueArn'],
                })
              : new DescribeEventBusCommand({ Name: c.eventBus }),
            { abortSignal: signal },
          )
          return {
            level: 'credentials_verified',
            detail:
              'Resource lookup accepted. Publishing permission is verified only by explicit test send.',
          }
        }
        if (kind === 'aws_sqs') {
          const fifo = c.queueUrl.endsWith('.fifo')
          const result = await client.send(
            new SendMessageCommand({
              QueueUrl: c.queueUrl,
              MessageBody: output.serialized,
              MessageAttributes: {
                struct_event_id: { DataType: 'String', StringValue: body.id },
              },
              ...(fifo
                ? {
                    MessageGroupId:
                      c.messageGroup === 'device'
                        ? body.device_id
                        : c.messageGroup,
                    MessageDeduplicationId: job.id,
                  }
                : {}),
            }),
            { abortSignal: signal },
          )
          if (typeof result.MessageId !== 'string' || !result.MessageId)
            fail('SQS acknowledgment missing message ID')
          return accepted(
            'SQS accepted the message; subscriber processing is not confirmed',
            result.MessageId,
          )
        }
        await client.send(new DescribeEventBusCommand({ Name: c.eventBus }), {
          abortSignal: signal,
        })
        const result = await client.send(
            new PutEventsCommand({
              Entries: [
                {
                  EventBusName: c.eventBus,
                  Source: c.source,
                  DetailType: c.detailType,
                  Detail: output.serialized,
                },
              ],
            }),
            { abortSignal: signal },
          ),
          entry = result.Entries?.[0]
        if (result.FailedEntryCount || entry?.ErrorCode)
          throw Object.assign(new Error('EventBridge entry rejected'), {
            name: entry?.ErrorCode || 'InvalidAcknowledgment',
          })
        if (typeof entry?.EventId !== 'string' || !entry.EventId)
          fail('EventBridge acknowledgment missing event ID')
        return accepted(
          'EventBridge accepted the event entry; rule processing is not confirmed',
          entry.EventId,
        )
      } finally {
        client.destroy?.()
      }
    }
    if (kind === 'http') {
      const response = await (dependencies.postWebhook || postWebhook)(
        c.url,
        output.serialized,
        {
          'content-type': 'application/json',
          ...c.headers,
          ...(s.bearerToken
            ? { authorization: `Bearer ${s.bearerToken}` }
            : {}),
          'x-struct-event-id': body.id,
          'x-struct-delivery-id': job.id,
          'x-struct-attempt': String(job.total_attempts || 1),
          'x-struct-signature': signWebhookBody(
            s.signingSecret,
            output.serialized,
          ),
        },
        signal,
      )
      return {
        ...classifyResponse(response.status),
        httpStatus: response.status,
        retryAfter: retryAfter(response.retryAfter),
      }
    }
    if (kind === 'azure_service_bus') {
      if (mode === 'verify')
        return {
          level: 'configuration_valid',
          detail:
            'SAS credentials and namespace validated. A send-only policy cannot inspect entities; use explicit test send to prove access.',
        }
      const r = await send(
        `https://${c.namespace}.servicebus.windows.net/${c.entity}/messages`,
        {
          headers: {
            authorization: azureAuth(c, s),
            'x-ms-retrypolicy': 'NoRetry',
            'content-type': 'application/json',
            brokerproperties: JSON.stringify({
              MessageId: job.id,
              CorrelationId: body.id,
              ContentType: 'application/json',
            }),
          },
          body: output.serialized,
          signal,
        },
      )
      if (r.status !== 201 && r.status >= 200 && r.status < 300)
        fail('Unexpected Service Bus acknowledgment status')
      return {
        ...classifyResponse(r.status),
        detail:
          r.status === 201
            ? 'Azure accepted the message; consumer processing is not confirmed'
            : `Azure request returned HTTP ${r.status}`,
        httpStatus: r.status,
        retryAfter: retryAfter(r.headers?.['retry-after']),
      }
    }
    if (kind === 'google_pubsub') {
      const token = await googleToken(s, send, signal),
        url = `https://pubsub.googleapis.com/v1/projects/${c.project}/topics/${encodeURIComponent(c.topic)}`
      const r = await send(url + (mode === 'verify' ? '' : ':publish'), {
        method: mode === 'verify' ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body:
          mode === 'verify'
            ? ''
            : JSON.stringify({
                messages: [
                  {
                    data: Buffer.from(output.serialized).toString('base64'),
                    attributes: {
                      struct_event_id: body.id,
                      struct_delivery_id: job.id,
                    },
                  },
                ],
              }),
        signal,
      })
      if (r.status !== 200 && r.status >= 200 && r.status < 300)
        fail('Unexpected Pub/Sub acknowledgment status')
      if (r.status !== 200)
        return {
          ...classifyResponse(r.status),
          httpStatus: r.status,
          detail: `Pub/Sub request returned HTTP ${r.status}`,
        }
      if (mode === 'verify')
        return {
          level: 'credentials_verified',
          detail:
            'Topic lookup accepted. Publish permission requires explicit test send.',
        }
      if (
        !Array.isArray(parse(r).messageIds) ||
        parse(r).messageIds.length !== 1 ||
        typeof parse(r).messageIds[0] !== 'string' ||
        !parse(r).messageIds[0]
      )
        fail('Pub/Sub acknowledgment missing message ID')
      return accepted(
        'Pub/Sub accepted the publication; subscriber processing is not confirmed',
        parse(r).messageIds[0],
      )
    }
    const pool = await pgPool(c, s, dependencies),
      table = `"${identifier(c.schema)}"."${identifier(c.table)}"`
    if (mode === 'verify') {
      // Read-only schema/privilege check. Does not create a table or send a reading.
      const r = await pool.query(
        "select has_table_privilege(current_user,$1,'INSERT') allowed, exists(select 1 from pg_index where indrelid=$1::regclass and indisunique and indisvalid and indisready and indexprs is null and indnkeyatts=1 and indkey[0]=(select attnum from pg_attribute where attrelid=$1::regclass and attname='event_id') and indpred is null) idempotent",
        [table],
      )
      if (!r.rows[0]?.allowed || !r.rows[0]?.idempotent)
        fail('Table requires INSERT privilege and a unique event_id key')
      await pool.query(
        `select event_id,device_id,received_at,payload from ${table} limit 0`,
      )
      return {
        level: 'connection_established',
        detail:
          'TLS connection, columns, insert privilege and unique event_id checked. No insert executed.',
      }
    }
    const r = await pool.query(
      `insert into ${table}(event_id,device_id,received_at,payload) values($1,$2,$3,$4::jsonb) on conflict(event_id) do nothing`,
      [body.id, body.device_id, body.timestamp, output.serialized],
    )
    return accepted(
      r.rowCount
        ? 'PostgreSQL insert committed'
        : 'PostgreSQL already contains this event ID; duplicate insert suppressed',
    )
  } catch (error) {
    return providerError(error)
  }
}
module.exports = { execute, providerError, closePools, azureAuth, googleToken }
