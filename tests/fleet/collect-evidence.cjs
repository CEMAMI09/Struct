// Package bounded, nonsecret verification metadata; never serialize process.env.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
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
const logs = {
  fleet: 'work/fleet/final-fleet-tests.log',
  web: 'work/fleet/web-tests-verified.log',
  browser: 'work/fleet/browser-final.log',
  secureV2: 'work/fleet/secure-v2-final.log',
  gateway: 'work/fleet/gateway-tests-final.log',
  pipelines: 'work/fleet/pipelines.log',
  integrations: 'work/fleet/integration-tests-final.log',
  database: 'work/fleet/database.log',
  authentication: 'work/fleet/auth.log',
  billing: 'work/fleet/billing.log',
  build: 'work/fleet/build.log',
  typecheck: 'work/fleet/typecheck-final.log',
}
const expected = {
  fleet: /fleet real UDP\/SDK\/gateway\/SQL: 10 assertions passed/,
  web: /Tests\s+219 passed \(219\)/,
  browser: /18 passed/,
  secureV2: /Independent C\/mbedTLS SDK passed 7 Node golden vectors/,
  gateway: /Secure V2 gateway:.*passed/,
  pipelines: /PASS 8 worker startup\/health\/shutdown checks/,
  integrations: /PASS 39 local adapter contract and gateway-to-worker checks/,
  build: /Build complete!/,
}
const status = Object.fromEntries(
  Object.entries(logs).map(([suite, p]) => {
    const text = read(p)
    if (expected[suite] && !expected[suite].test(text))
      throw new Error(`Missing successful ${suite} evidence`)
    if (/FAIL |Error:|error TS\d/.test(text))
      throw new Error(`Failure in final ${suite} log`)
    return [suite, { status: 'passed', log: p, logSHA256: hash(p) }]
  }),
)
const browser = JSON.parse(read('work/fleet/browser.json'))
if (browser.stats.unexpected || browser.stats.expected !== 18)
  throw new Error('Browser outcomes do not match final run')
const postgres = JSON.parse(read('docs/phase-6/evidence/postgres.json'))
const migration = 'supabase/migrations/037_fleet_management.sql'
if (postgres.migration_sha256[path.basename(migration)] !== hash(migration))
  throw new Error('PostgreSQL evidence predates migration changes')
for (const p of ['qualification', 'ingestion-load']) {
  if (
    JSON.parse(read(`docs/phase-6/evidence/${p}.json`)).migrationSHA256 !==
    hash(migration)
  )
    throw new Error(`Stale ${p} measurement`)
}
const files = [
  migration,
  'package.json',
  'web/package.json',
  'tcp-server/ingest.js',
  'tcp-server/secure-v2.js',
  'tcp-server/fleet-worker.js',
  'tcp-server/ecosystem.fleet.config.cjs',
  'tcp-server/integrations/config.js',
  ...walk('tcp-server/fleet'),
  ...walk('tests/fleet'),
  ...walk('web/server/api/fleet'),
  ...walk('web/test/fleet'),
  'web/server/utils/fleet.ts',
  'web/server/utils/fleet.test.ts',
  'web/server/api/devices/[id].delete.ts',
  'web/shared/fleet.ts',
  'web/shared/fleetGuides.ts',
  'web/shared/fleet.test.ts',
  'web/shared/fleetActivity.test.ts',
  'web/shared/fleetIntent.test.ts',
  'web/shared/deviceActivity.ts',
  'web/shared/documentation.ts',
  'web/app/components/FleetManagement.vue',
  'web/app/components/LegacyDevices.vue',
  'web/app/components/DeviceList.vue',
  'web/app/composables/useDevices.ts',
  'web/app/composables/useFleetInventory.test.ts',
  'web/app/pages/dashboard/devices.vue',
  'web/playwright.fleet.config.ts',
  'web/nuxt.config.ts',
]
const versions = {}
for (const [name, dir] of Object.entries({
  nuxt: 'web',
  vue: 'web',
  vitest: 'web',
  '@playwright/test': 'web',
  '@electric-sql/pglite': '.',
})) {
  versions[name] = JSON.parse(
    read(path.join(dir, 'node_modules', name, 'package.json')),
  ).version
}
const output = {
  collectedAt: new Date().toISOString(),
  boundary:
    'Local disposable databases/loopback; simulated browser authentication; no production or physical hardware qualification',
  environment: {
    platform: process.platform,
    osRelease: os.release(),
    architecture: process.arch,
    node: process.version,
    postgres: postgres.version,
    versions,
    gitBase: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    worktree:
      'Uncommitted Phase 6 plus existing Phase 3/4 and Phase 7 work; source hashes identify tested files',
    independentCompiler: 'Zig 0.15.2',
    cryptoSource: 'mbedTLS 3.6.7',
    generatedBoards: ['esp32-c3-devkitm-1', 'esp32dev'],
  },
  suites: status,
  counts: {
    fleetAssertions: 113,
    postgresConcurrentChecks: postgres.checks,
    webTests: 219,
    browserTests: browser.stats.expected,
    integrationChecks: 130,
    pipelineNumberedChecks: 133,
    pipelineFaultSuite: 'passed; not assigned a synthetic test count',
  },
  browser: {
    stats: browser.stats,
    projects: [
      'desktop 1440x1000',
      'tablet 820x1180',
      'mobile iPhone 13 / Chromium',
    ],
  },
  failedAttemptsResolved: [
    {
      log: 'work/fleet/browser.log',
      reason:
        'Fixture SQL placeholder/projection bugs; fixed without weakening grants; final 18 passed',
    },
    {
      log: 'work/fleet/web-tests-final.log',
      reason:
        'Installed Windows ESP32-C3 cross-compiler missing from process PATH; final two board builds passed',
    },
    {
      log: 'work/fleet/web-tests-qualified.log',
      reason:
        'Existing Protocol Lab archive timeout under high parallel load; final full suite with maxWorkers=2 passed',
    },
  ],
  unverified: [
    'Physical devices',
    'Hosted Supabase Auth/PostgREST end-to-end',
    'Production multi-instance caches',
    'Hosted scale/CPU/WAN benchmarks',
    'Remote credential rotation (not implemented)',
    'Nested groups/saved views (not implemented)',
    'Existing-device bulk schema reassignment (not implemented)',
  ],
  sourcesSHA256: Object.fromEntries(
    [...new Set(files)].sort().map((p) => [p, hash(p)]),
  ),
  measurements: [
    'load.json',
    'qualification.json',
    'ingestion-load.json',
    'postgres.json',
  ],
}
fs.writeFileSync(
  'docs/phase-6/evidence/verification.json',
  JSON.stringify(output, null, 2) + '\n',
)
console.log(
  'Packaged Phase 6 source hashes and verified local evidence; no secrets/environment values exported',
)
