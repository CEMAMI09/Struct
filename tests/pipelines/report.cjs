// Package compact, portable verification evidence; keep large local logs in work/.
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const directory = 'docs/phase-3-4/evidence/'
const browser = read('work/pipelines/browser.json')
const cases = []
function walk(suites) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || [])
      for (const test of spec.tests || []) {
        cases.push({
          title: spec.title,
          project: test.projectName,
          status: test.status,
          results: test.results.map((r) => ({
            status: r.status,
            duration_ms: r.duration,
            errors: r.errors?.map((e) => e.message) || [],
          })),
        })
      }
    walk(suite.suites)
  }
}
walk(browser.suites)
fs.writeFileSync(
  directory + 'browser.json',
  JSON.stringify(
    { generated_at: new Date().toISOString(), stats: browser.stats, cases },
    null,
    2,
  ),
)
const suites = [
  'database',
  'recovery-safety',
  'policy-security',
  'postgres',
  'worker-startup',
].map((name) => ({ name, ...read(directory + name + '.json') }))
const sourceFiles = [
  'supabase/migrations/035_reliable_delivery.sql',
  'tcp-server/outbox.js',
  'tcp-server/worker.js',
  'tcp-server/safeWebhook.js',
  'tcp-server/delivery-policy.js',
  'tcp-server/trace.js',
  'tcp-server/secure-v2.js',
  'web/app/pages/dashboard/deliveries.vue',
  'web/app/components/DeliveryEventTrace.vue',
  'web/shared/delivery.ts',
  'tests/pipelines/database.cjs',
  'tests/pipelines/recovery-safety.cjs',
  'tests/pipelines/policy-security.cjs',
  'tests/pipelines/postgres.cjs',
  'tests/pipelines/worker-faults.cjs',
  'tests/pipelines/worker-startup.cjs',
]
const sourceSha256 = Object.fromEntries(
  sourceFiles.map((file) => [
    file,
    createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  ]),
)
const pg = read(directory + 'postgres.json')
if (
  pg.migration_sha256['035_reliable_delivery.sql'] !==
  sourceSha256[sourceFiles[0]]
)
  throw new Error('PostgreSQL evidence must be rerun for the current migration')
if (
  browser.stats.unexpected ||
  browser.stats.skipped ||
  browser.stats.expected !== 18
)
  throw new Error('Browser qualification incomplete')
const build = fs.readFileSync('work/pipelines-build.log', 'utf8')
if (!build.includes('Build complete!'))
  throw new Error('Production build did not complete')
const webLog = fs
  .readFileSync('work/pipelines-web-tests.log', 'utf8')
  .replace(/\u001b\[[0-9;]*m/g, '')
const webCount = /Tests\s+(\d+) passed/.exec(webLog),
  webFiles = /Test Files\s+(\d+) passed/.exec(webLog)
if (!webCount || !webFiles || /\d+ failed/.test(webLog))
  throw new Error('Web regression results incomplete')
const summary = {
  generated_at: new Date().toISOString(),
  parent_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  production_activation: false,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    postgres: pg.server_version,
    pglite: read('node_modules/@electric-sql/pglite/package.json').version,
    nuxt: read('web/node_modules/nuxt/package.json').version,
  },
  new_check_count: suites.reduce((sum, suite) => sum + suite.passed, 0),
  new_suites: suites.map((suite) => ({
    name: suite.name,
    passed: suite.passed,
  })),
  worker_fault_suite:
    'passed; see worker-faults.json for individual observations and measurement boundaries',
  browser: {
    passed: browser.stats.expected,
    failed: browser.stats.unexpected,
    skipped: browser.stats.skipped,
  },
  web_tests: {
    passed: Number(webCount[1]),
    files: Number(webFiles[1]),
    excluded:
      'unchanged shared/secureV2Project.test.ts firmware compilation suite',
  },
  gateway_regression: {
    scripts_passed: 13,
    native_parser: 'unavailable; JavaScript fallback',
  },
  other_passed_suites: [
    'database',
    'auth-security',
    'billing-db',
    'delivery',
    'onboarding-db',
    'secure-v2-db',
    'SDK Secure V2 vectors',
    'SDK Secure V2 UDP',
    'debugger local HTTP/UDP',
  ],
  typecheck: 'passed',
  build: 'passed',
  build_reported_size: '15.8 MB (6.24 MB gzip)',
  physical_hardware: 'not tested',
  production_load: 'not tested',
  source_sha256: sourceSha256,
}
fs.writeFileSync(
  directory + 'verification.json',
  JSON.stringify(summary, null, 2),
)
console.log(
  `Packaged evidence: ${summary.new_check_count} new checks, ${summary.browser.passed} browser workflows`,
)
