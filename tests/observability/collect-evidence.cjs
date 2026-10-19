// Package bounded nonsecret local verification evidence. Never serialize env or fixture sessions.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const read = (p) => fs.readFileSync(p, 'utf8')
const hash = (p) =>
  crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name).replaceAll('\\', '/')
    return e.isDirectory() ? walk(p) : [p]
  })
const migration = 'supabase/migrations/038_monitoring_analytics.sql'
const logs = {
  observability: [
    'work/fleet/observability-suites-final.log',
    /PASS 29 fault\/hold/,
  ],
  web: ['work/fleet/observability-web-final.log', /237 passed \(237\)/],
  browser: ['work/fleet/observability-browser-final.log', /9 passed/],
  secureV2: [
    'work/fleet/observability-secure-v2.log',
    /Independent C\/mbedTLS SDK passed 7 Node golden vectors/,
  ],
  gateway: [
    'work/fleet/observability-gateway.log',
    /Secure V2 gateway:.*passed/,
  ],
  pipelines: [
    'work/fleet/observability-pipelines.log',
    /PASS 8 worker startup\/health\/shutdown checks/,
  ],
  integrations: [
    'work/fleet/observability-integrations.log',
    /PASS 39 local adapter contract and gateway-to-worker checks/,
  ],
  fleet: [
    'work/fleet/observability-fleet.log',
    /fleet real UDP\/SDK\/gateway\/SQL: 10 assertions passed/,
  ],
  typecheck: ['work/fleet/observability-typecheck-final.log', /nuxt typecheck/],
  build: ['work/fleet/observability-build-final.log', /Build complete!/],
}
const suites = Object.fromEntries(
  Object.entries(logs).map(([name, [file, success]]) => {
    const text = read(file)
    if (!success.test(text) || /FAIL |error TS\d|Failed Tests/.test(text))
      throw Error(`Missing successful ${name} evidence`)
    return [
      name,
      {
        status: 'passed',
        log: file,
        logSHA256: hash(file),
        checks:
          name === 'observability'
            ? [...text.matchAll(/PASS (\d+)/g)].reduce(
                (n, m) => n + Number(m[1]),
                0,
              )
            : undefined,
      },
    ]
  }),
)
const browser = JSON.parse(read('work/fleet/observability-browser.json'))
if (
  browser.stats.unexpected ||
  browser.stats.expected !== 9 ||
  browser.stats.skipped ||
  browser.stats.flaky
)
  throw Error('Unexpected browser outcomes')
const measurements = Object.fromEntries(
  ['postgres-performance', 'synthetic-scale', 'gateway-performance'].map(
    (name) => {
      const file = `docs/phase-5-8/evidence/${name}.json`,
        data = JSON.parse(read(file))
      if (data.migrationSHA256 !== hash(migration))
        throw Error(`Stale ${name} measurement`)
      return [
        name,
        { file, SHA256: hash(file), boundary: data.scope || data.boundary },
      ]
    },
  ),
)
const files = [
  migration,
  'package.json',
  'web/package.json',
  'web/nuxt.config.ts',
  'tcp-server/secure-v2.js',
  'tcp-server/ingest.js',
  'tcp-server/udp.js',
  'tcp-server/observability-worker.js',
  'tcp-server/ecosystem.observability.config.cjs',
  ...walk('tcp-server/observability'),
  ...walk('tests/observability'),
  ...walk('web/server/api/observability'),
  ...walk('web/test/observability'),
  'web/server/utils/observability.ts',
  'web/server/utils/observability.test.ts',
  'web/shared/observability.ts',
  'web/shared/observability.test.ts',
  'web/shared/observabilityGuides.ts',
  'web/app/components/ObservabilityDashboard.vue',
  'web/app/components/UsageChart.vue',
  'web/app/pages/dashboard/monitoring.vue',
  'web/app/pages/dashboard/analytics.vue',
  'web/app/pages/dashboard/alerts.vue',
  'web/app/components/AppSidebar.vue',
  'web/app/layouts/default.vue',
  'web/app/components/DeliveryEventTrace.vue',
  'web/server/protocol-lab/engine.ts',
  'protocol/schema/bitpacked.cjs',
  'sdk/js/secure-v2.cjs',
  ...walk('docs/phase-5-8').filter((p) => !p.includes('/evidence/')),
  ...walk('docs/phase-5-8/evidence').filter((p) => p.endsWith('.png')),
]
const versions = {}
for (const [name, dir] of Object.entries({
  nuxt: 'web',
  vue: 'web',
  vitest: 'web',
  '@playwright/test': 'web',
  '@electric-sql/pglite': '.',
}))
  versions[name] = JSON.parse(
    read(path.join(dir, 'node_modules', name, 'package.json')),
  ).version
const result = {
  generatedAt: new Date().toISOString(),
  gitBase: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  workingTree:
    'Uncommitted coordinated Phase 3/4, 7, 6 and 5/8 changes; no production deployment',
  environment: {
    os: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    node: process.version,
    versions,
  },
  suites,
  browser: browser.stats,
  measurements,
  sources: [
    {
      title: 'Protocol Lab validated UDP/IPv4/IPv6 minimum header references',
      registry: 'benchmarks/multi-protocol/references/sources.json',
      SHA256: hash('benchmarks/multi-protocol/references/sources.json'),
    },
    {
      title: 'Resend send API',
      url: 'https://resend.com/docs/api-reference/emails/send-email',
      retrieved: '2026-10-13',
    },
    {
      title: 'Resend idempotency keys',
      url: 'https://resend.com/docs/dashboard/emails/idempotency-keys',
      retrieved: '2026-10-13',
    },
  ],
  files: Object.fromEntries(
    [...new Set(files)].sort().map((p) => [p, hash(p)]),
  ),
  unverified: [
    'Physical hardware',
    'Live email/provider delivery',
    'Hosted Supabase Auth/PostgREST',
    'Production traffic and carrier billing',
    'Sustained production-scale load (100000 synthetic records were tested)',
    'Database server CPU and resource telemetry',
    'Full assistive-technology audit',
  ],
}
fs.writeFileSync(
  'docs/phase-5-8/evidence/qualification.json',
  JSON.stringify(result, null, 2) + '\n',
)
console.log(
  'PASS bounded qualification evidence with current migration hashes and explicit unverified boundaries',
)
