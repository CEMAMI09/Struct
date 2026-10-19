const { validateWebhookUrl } = require('../safeWebhook')
const { isIP } = require('node:net')
const { isPublicAddress } = require('../safeWebhook')
const kinds = [
  'http',
  'aws_sqs',
  'aws_eventbridge',
  'azure_service_bus',
  'google_pubsub',
  'postgresql',
]
const fail = (message) => {
  throw Object.assign(new Error(message), { code: 'INTEGRATION_CONFIG' })
}
const object = (v) => v && typeof v === 'object' && !Array.isArray(v)
const text = (v, label, max = 256) => {
  if (
    typeof v !== 'string' ||
    !v.length ||
    v.length > max ||
    /[\x00-\x1f]/.test(v)
  )
    fail(`Invalid ${label}`)
  return v
}
const identifier = (v) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(text(v, 'SQL identifier', 63)))
    fail('Invalid SQL identifier')
  return v
}
function validateRoute(rule, depth = 0, counter = { n: 0 }) {
  if (rule == null && depth === 0) return null
  if (!object(rule) || depth > 5 || ++counter.n > 64)
    fail('Routing expression exceeds limits')
  if ('all' in rule || 'any' in rule) {
    const mode = 'all' in rule ? 'all' : 'any',
      children = rule[mode]
    if (
      Object.keys(rule).length !== 1 ||
      !Array.isArray(children) ||
      !children.length ||
      children.length > 16
    )
      fail('Invalid routing group')
    return { [mode]: children.map((r) => validateRoute(r, depth + 1, counter)) }
  }
  const field = text(rule.field, 'routing field', 128)
  if (
    !/^(payload\.[a-zA-Z0-9_.-]+|device_id|schema_slot|schema_version|event_type|group_ids|labels)$/.test(
      field,
    ) ||
    field
      .split('.')
      .some((p) => ['__proto__', 'constructor', 'prototype'].includes(p))
  )
    fail('Invalid routing field')
  if (['group_ids', 'labels'].includes(field) && (rule.op !== 'contains' || typeof rule.value !== 'string')) fail('Membership routes require contains and a string value')
  if (
    !['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'].includes(
      rule.op,
    )
  )
    fail('Invalid routing operator')
  if (
    rule.op !== 'exists' &&
    (rule.value == null ||
      !['string', 'number', 'boolean'].includes(typeof rule.value))
  )
    fail('Routing comparison needs a scalar value')
  if (
    typeof rule.value === 'number' &&
    (!Number.isFinite(rule.value) ||
      (Number.isInteger(rule.value) && !Number.isSafeInteger(rule.value)))
  )
    fail('Use a decimal string for large integers')
  if (typeof rule.value === 'string') text(rule.value, 'routing value', 1024)
  if (
    ['gt', 'gte', 'lt', 'lte'].includes(rule.op) &&
    !/^-?\d+(\.\d+)?$/.test(String(rule.value))
  )
    fail('Threshold must be a decimal value')
  return {
    field,
    op: rule.op,
    ...(rule.op === 'exists' ? {} : { value: rule.value }),
  }
}
function validateMapping(input) {
  if (input == null)
    return {
      format: 'envelope-v1',
      fields: [],
      metadata: ['device_id', 'timestamp', 'schema'],
    }
  if (
    !object(input) ||
    !['envelope-v1', 'flat-v1'].includes(input.format) ||
    !Array.isArray(input.fields) ||
    input.fields.length > 100 ||
    !Array.isArray(input.metadata)
  )
    fail('Invalid field mapping')
  const targets = new Set(['event_id', 'format_version', 'event_type'])
  const fields = input.fields.map((f) => {
    if (
      !object(f) ||
      !/^[a-zA-Z0-9_.-]{1,128}$/.test(f.from) ||
      f.from
        .split('.')
        .some((p) => ['__proto__', 'constructor', 'prototype'].includes(p)) ||
      !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(f.to) ||
      [
        '__proto__',
        'constructor',
        'prototype',
        'device_id',
        'timestamp',
        'schema',
      ].includes(f.to) ||
      targets.has(f.to)
    )
      fail('Invalid or duplicate mapping field')
    targets.add(f.to)
    if (f.convert && !['identity', 'string', 'boolean'].includes(f.convert))
      fail('Unsupported conversion; numeric narrowing is not permitted')
    return {
      from: f.from,
      to: f.to,
      convert: f.convert || 'identity',
      required: f.required !== false,
    }
  })
  if (
    input.metadata.some(
      (m) => !['device_id', 'timestamp', 'schema'].includes(m),
    ) ||
    input.metadata.length > 3 ||
    new Set(input.metadata).size !== input.metadata.length
  )
    fail('Invalid metadata selection')
  return { format: input.format, fields, metadata: input.metadata }
}
function validateConfig(kind, input) {
  if (
    !kinds.includes(kind) ||
    !object(input) ||
    Buffer.byteLength(JSON.stringify(input)) > 16384
  )
    fail('Invalid integration configuration')
  if (kind === 'http') {
    const url = validateWebhookUrl(text(input.url, 'HTTPS URL', 2048)).href
    if (new URL(url).search || new URL(url).hash)
      fail('Use authentication headers rather than URL query credentials')
    const headers = input.headers || {}
    if (!object(headers) || Object.keys(headers).length > 12)
      fail('Invalid custom metadata headers')
    for (const [k, v] of Object.entries(headers)) {
      if (
        !/^x-meta-[a-z0-9-]{1,48}$/.test(k) ||
        /secret|token|key|auth|cookie/i.test(k)
      )
        fail('Custom headers must be nonsecret x-meta-* metadata')
      text(v, 'header value', 256)
    }
    return { url, headers }
  }
  if (kind.startsWith('aws_')) {
    const region = text(input.region, 'AWS region', 40)
    if (
      !/^[a-z]{2}-[a-z]+-\d$/.test(region) ||
      region.startsWith('cn-') ||
      region.startsWith('us-gov-')
    )
      fail('Only standard AWS commercial regions supported')
    if (kind === 'aws_sqs') {
      const url = new URL(text(input.queueUrl, 'queue URL', 512))
      if (
        url.origin !== `https://sqs.${region}.amazonaws.com` ||
        !/^\/\d{12}\/[a-zA-Z0-9_-]+(?:\.fifo)?$/.test(url.pathname) ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
        fail('SQS URL must match its region and AWS queue path')
      const group = input.messageGroup || 'device'
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(group))
        fail('Invalid FIFO message group')
      return { region, queueUrl: url.href, messageGroup: group }
    }
    const bus = text(input.eventBus, 'event bus', 256),
      source = text(input.source || 'struct.telemetry', 'source'),
      detailType = text(input.detailType || 'Telemetry', 'detail type')
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(bus) || bus.includes(':'))
      fail('Use an event bus name, not an arbitrary endpoint or ARN')
    return { region, eventBus: bus, source, detailType }
  }
  if (kind === 'azure_service_bus') {
    const namespace = text(input.namespace, 'namespace', 50),
      entity = text(input.entity, 'queue/topic', 128)
    if (
      !/^[a-zA-Z][a-zA-Z0-9-]{4,48}[a-zA-Z0-9]$/.test(namespace) ||
      !/^[a-zA-Z0-9_.-]{1,128}$/.test(entity)
    )
      fail('Invalid Azure namespace or entity')
    return { namespace, entity }
  }
  if (kind === 'google_pubsub') {
    const project = text(input.project, 'project'),
      topic = text(input.topic, 'topic')
    if (
      !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) ||
      !/^[a-zA-Z][a-zA-Z0-9-_.~+%]{2,254}$/.test(topic) ||
      topic.startsWith('goog')
    )
      fail('Invalid Google project or topic')
    return { project, topic }
  }
  const host = text(input.host, 'database host', 253),
    port = Number(input.port || 5432)
  if (
    !/^[a-zA-Z0-9.:-]+$/.test(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    (isIP(host) && !isPublicAddress(host)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    fail('Database requires a public hostname/IP and valid port')
  return {
    host,
    port,
    database: text(input.database, 'database', 63),
    schema: identifier(input.schema || 'public'),
    table: identifier(input.table),
  }
}
function validateCredentials(kind, s) {
  if (!object(s) || Buffer.byteLength(JSON.stringify(s)) > 20000)
    fail('Credentials are required')
  if (kind === 'http') {
    text(s.signingSecret, 'signing secret', 512)
    if (s.bearerToken) text(s.bearerToken, 'bearer token', 4096)
    return {
      signingSecret: s.signingSecret,
      ...(s.bearerToken ? { bearerToken: s.bearerToken } : {}),
    }
  }
  if (kind.startsWith('aws_')) {
    if (!/^[A-Z0-9]{16,128}$/.test(s.accessKeyId))
      fail('Invalid AWS access key')
    text(s.secretAccessKey, 'AWS secret', 256)
    if (s.sessionToken) text(s.sessionToken, 'AWS session token', 8192)
    return {
      accessKeyId: s.accessKeyId,
      secretAccessKey: s.secretAccessKey,
      ...(s.sessionToken ? { sessionToken: s.sessionToken } : {}),
    }
  }
  if (kind === 'azure_service_bus') {
    text(s.keyName, 'SAS policy name', 128)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s.key)) fail('Invalid Azure SAS key')
    return { keyName: s.keyName, key: s.key }
  }
  if (kind === 'google_pubsub') {
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(s.clientEmail))
      fail('Service account email required')
    if (
      typeof s.privateKey !== 'string' ||
      s.privateKey.length > 8192 ||
      !s.privateKey.includes('PRIVATE KEY')
    )
      fail('Service account private key required')
    try {
      if (
        require('node:crypto').createPrivateKey(s.privateKey)
          .asymmetricKeyType !== 'rsa'
      )
        fail('RSA private key required')
    } catch {
      fail('Invalid RSA private key')
    }
    return { clientEmail: s.clientEmail, privateKey: s.privateKey }
  }
  text(s.user, 'database user', 128)
  text(s.password, 'database password', 4096)
  if (
    s.ca &&
    (typeof s.ca !== 'string' ||
      s.ca.length > 12000 ||
      !s.ca.includes('CERTIFICATE'))
  )
    fail('Invalid CA certificate')
  return { user: s.user, password: s.password, ...(s.ca ? { ca: s.ca } : {}) }
}
module.exports = {
  kinds,
  fail,
  validateRoute,
  validateMapping,
  validateConfig,
  validateCredentials,
  identifier,
}
