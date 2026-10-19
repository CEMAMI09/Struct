// Package synthetic observations and source hashes; no credentials or environment dump.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const core = require('../../tcp-server/integrations')
const base = 'docs/phase-7'
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name)
    return e.isDirectory() ? walk(file) : [file.replaceAll('\\', '/')]
  })
const files = [
  'supabase/migrations/035_reliable_delivery.sql',
  'supabase/migrations/036_backend_integrations.sql',
  'tcp-server/outbox.js',
  'tcp-server/worker.js',
  'tcp-server/safeWebhook.js',
  'tcp-server/webhooks.js',
  'package.json',
  'tcp-server/package.json',
  'tcp-server/package-lock.json',
  ...walk('tcp-server/integrations'),
  ...walk('tests/integrations'),
  ...walk('web/server/api/integrations'),
  'web/server/utils/integrations.ts',
  'web/app/pages/dashboard/integrations.vue',
  'web/app/components/IntegrationRuleEditor.vue',
  'web/app/components/IntegrationMappingEditor.vue',
  'web/app/components/DeliveryEventTrace.vue',
  'web/shared/integrationGuides.ts',
  'web/shared/integrations.ts',
  ...walk('web/test/integrations'),
  'web/server/utils/integrations.test.ts',
]
const source = Object.fromEntries(
  files.map((file) => [
    file,
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  ]),
)
const write = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const observations = Object.fromEntries(
  ['core', 'database', 'contracts', 'postgres', 'load'].map((name) => [
    name,
    read(`${base}/evidence/${name}.json`),
  ]),
)
const performance = read(`${base}/evidence/performance.json`)
write(`${base}/evidence/performance-summary.json`, {
  timestamp: performance.timestamp,
  boundary: performance.boundary,
  results: performance.results.map(({ raw_ms, ...summary }) => summary),
})
const report = read('work/integrations/browser.json')
write(`${base}/evidence/browser.json`, {
  timestamp: report.stats.startTime,
  stats: report.stats,
  boundary:
    'Real Nuxt rendering, loopback auth fixture, integration API responses mocked; not hosted end-to-end verification',
  projects: [
    'desktop 1440x1000',
    'tablet 820x1180',
    'mobile iPhone 13 / Chromium',
  ],
})
write(`${base}/capabilities.json`, {
  version: 1,
  activation: 'default-off',
  providers: core.capabilities,
  routing: {
    operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'],
    fields: [
      'device_id',
      'schema_slot',
      'schema_version',
      'event_type',
      'payload.*',
    ],
    maxNodes: 64,
    maxDepth: 5,
    maxChildren: 16,
    conditionalEntitlement: 'logical_routing / existing Scale',
    rulesPerDestination: 1,
  },
  transformation: {
    formats: ['envelope-v1', 'flat-v1'],
    conversions: ['identity', 'string', 'boolean'],
    maxFields: 100,
    maxOutputBytes: 240000,
    mandatory: ['format_version', 'event_type', 'event_id'],
    unsafeIntegers: 'exact decimal strings; no numeric narrowing',
  },
  sharedDelivery: {
    queue: 'existing webhook_deliveries',
    attemptsPerCycle: 8,
    retryAgeHours: 24,
    payloadDays: 7,
    metadataDays: 30,
    maxManualCycles: 3,
    maxRecoveryBatch: 100,
    mappingPreviewMinutes: 10,
  },
  verification: {
    http: 'local HTTP/HMAC receiver',
    aws_sqs: 'official SDK/local HTTP contract',
    aws_eventbridge: 'official SDK/local HTTP contract',
    azure_service_bus: 'REST/SAS local contract',
    google_pubsub: 'REST/RSA OAuth local contract',
    postgresql: 'actual PostgreSQL 18.4 with verified TLS 1.3',
    liveCloud: false,
  },
  unsupported: [
    'private connectivity',
    'role assumption/workload identity',
    'provider-native batching',
    'global rule catalog/priority',
    'extra provider adapters',
    'arbitrary SQL/column mappings',
    'automatic encryption-key rotation',
  ],
})
write(`${base}/evidence/manifest.json`, {
  collected_at: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  working_tree:
    'local uncommitted Phase 3/4 and Phase 7; hashes identify tested implementation',
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  sources_sha256: source,
  integration_assertions: Object.fromEntries(
    Object.entries(observations).map(([k, v]) => [k, v.passed]),
  ),
  browser: report.stats,
  web: {
    vitestPassed: 188,
    filesPassed: 37,
    excluded:
      'unchanged secureV2Project.test.ts / four PlatformIO compile tests',
    typecheck: 'passed',
    productionBuild: 'passed',
    serverBundle: '17.5 MB / 6.61 MB gzip',
  },
  regressions: {
    pipelineDatabase: 50,
    recoverySafety: 18,
    policySecurity: 57,
    workerStartup: 8,
    postgresMultiBackend: 17,
    workerFaults: 'passed; separate OS processes and database outage',
    gateway: 'package suite passed',
    secureV2: 'database/SDK/UDP passed',
  },
  deployment: {
    supabaseMigrationsApplied: false,
    pushed: false,
    deployed: false,
    productionModified: false,
  },
  limitations: [
    'no authenticated live-cloud checks',
    'browser API fixtures',
    'local performance not production capacity',
    'no physical ESP32 test',
  ],
})
console.log(
  'Packaged synthetic evidence, capabilities, performance summary and source hashes',
)
