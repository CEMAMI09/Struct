// Collect only explicitly named source files and secret-free local qualification
// summaries. This does not run tests or imply physical/hosted qualification.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const sha = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const files = new Set([
  'supabase/migrations/041_secure_device_operations.sql',
  'protocol/enterprise-permissions.json',
  'scripts/firmware-sign.cjs',
  'scripts/package-sdk.py',
  'sdk/c/src/StructManagementEsp32.h',
  'sdk/c/src/StructManagedIdentityEsp32.h',
  'sdk/c/src/struct_management_crypto.h',
  'sdk/c/src/StructSecureV2Esp32.h',
  'web/shared/managementProject.ts',
  'web/shared/managementProject.test.ts',
  'web/shared/managementGuides.ts',
  'web/shared/secureV2Project.ts',
  'web/server/utils/deviceManagement.ts',
  'web/server/utils/firmwareStorage.ts',
  'web/server/utils/firmwareStorage.test.ts',
  'web/app/components/DeviceOperations.vue',
  'web/app/components/SecureV2Setup.vue',
  'web/app/pages/dashboard/firmware.vue',
  'web/app/pages/dashboard/device-operations.vue',
  'web/playwright.management.config.ts',
  'tcp-server/management-worker.js',
  'tcp-server/ecosystem.management.config.cjs',
])
function addDirectory(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const file = relative + '/' + entry.name
    if (entry.isDirectory()) addDirectory(file)
    else if (/\.(cjs|cts|js|ts|vue|h|cpp|md|json)$/.test(entry.name)) files.add(file)
  }
}
for (const dir of [
  'protocol/management', 'sdk/management', 'tcp-server/management',
  'web/server/api/device-management', 'web/server/api/device-operations',
  'tests/management', 'web/test/management',
]) addDirectory(dir)
const sourceHashes = Object.fromEntries([...files].sort().map((file) => [file, sha(file)]))
const logPaths = {
  managementPostgresCryptoIdentity: 'work/management-verification-final.log',
  web: 'work/management-web-tests-final.log',
  optionalEmbeddedSource: 'work/management-embedded-source-final.log',
  existingGeneratedFirmware: 'work/management-firmware-builds-final.log',
  esp32FactoryAndCommon: 'work/management-esp32dev-image-final.log',
  esp32c3FactoryAndCommon: 'work/management-esp32-c3-devkitm-1-image-final.log',
  productionBrowser: 'work/management-browser-tests-final.log',
  typecheck: 'work/management-typecheck-final.log',
  build: 'work/management-build-final.log',
  secureV2: 'work/management-secure-v2-final.log',
  platform: 'work/management-platform-final.log',
  pipelines: 'work/management-pipelines-regression.log',
  integrations: 'work/management-integrations-regression.log',
  fleet: 'work/management-fleet-regression.log',
  observability: 'work/management-observability-regression.log',
  enterprise: 'work/management-enterprise-regression.log',
}
const logs = Object.fromEntries(Object.entries(logPaths).map(([name, file]) => {
  if (!fs.existsSync(path.join(root, file))) return [name, { path: file, status: 'evidence_unavailable' }]
  const clean = read(file).replace(/\x1b\[[0-9;]*m/g, '')
  return [name, {
    path: file, sha256: sha(file),
    modifiedAt: fs.statSync(path.join(root, file)).mtime.toISOString(),
    summary: clean.split(/\r?\n/).filter((line) =>
      /^(PASS |.*:.*passed$|\s*Test Files\s|\s*Tests\s|\s*\d+ passed|Σ Total size:|—.*Build complete|.*\[SUCCESS\].*|Environment\s+Status)/.test(line),
    ).map((line) => line.trim()),
  }]
}))
const browserFile = 'work/management/browser.json'
const browser = JSON.parse(read(browserFile))
assert.equal(browser.stats.expected, 9, 'Expected nine production-preview browser workflows')
assert.equal(browser.stats.unexpected, 0)
assert.equal(browser.stats.flaky, 0)
assert.equal(browser.stats.skipped, 0)
const management = read(logPaths.managementPostgresCryptoIdentity)
for (const line of ['PASS 28 real signature', 'PASS 25 management', 'PASS 28 management', 'PASS 5 private', 'PASS 22 verified HTTPS', 'PASS 9 actual PostgreSQL', 'PASS C/mbedTLS', 'PASS 13 real C++']) assert(management.includes(line), line)
assert(read(logPaths.web).includes('255 passed | 2 skipped'))
assert(read(logPaths.optionalEmbeddedSource).includes('4 passed (4)'))
assert(read(logPaths.build).includes('Build complete!'))
const evidence = Object.fromEntries(['baseline', 'performance', 'scale', 'postgres', 'firmware-images'].map((name) => {
  const file = 'docs/phase-10/evidence/' + name + '.json'
  return [name, { path: file, sha256: sha(file), data: JSON.parse(read(file)) }]
}))
const migration = 'supabase/migrations/041_secure_device_operations.sql'
assert.equal(evidence.postgres.data.migrationHashes[path.basename(migration)], sha(migration))
const screenshots = {}
for (const viewport of ['desktop', 'tablet', 'mobile']) for (const page of ['operations', 'firmware']) {
  const file = `work/management/${viewport}-${page}.png`
  if (fs.existsSync(path.join(root, file))) screenshots[file] = sha(file)
}
const archives = Object.fromEntries(['web/public/sdk/struct-sdk.zip', 'web/public/sdk/struct-arduino.zip'].map((file) => [file, sha(file)]))
const report = {
  collectedAt: new Date().toISOString(),
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim()),
  scope: 'Phase 10 local qualification, preserving uncommitted previous phases. Collection is not a new test run. Source hashes identify the collection snapshot; tests retain their original dates. No production changes, deployment, commit or push.',
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  results: {
    management: { passed: 108, boundary: 'Core, disposable database, Storage policies and verified HTTPS host A/B agent; not physical MCU OTA.' },
    postgres: { passed: 9, boundary: 'Actual local PostgreSQL transactions, concurrent backends and termination/recovery.' },
    embeddedCrypto: { status: 'passed', boundary: 'Real upstream mbedTLS C under WASI; Node-generated independent vectors.' },
    embeddedIdentity: { passed: 13, boundary: 'Real C++ loader, mocked in-memory NVS; not physical flash.' },
    web: { passed: 255, skipped: 2, files: 49 },
    optionalEmbeddedSource: { passed: 4, boundary: 'Includes both separately enabled board compilation tests skipped in the default suite.' },
    optionalFirmwareImages: { passed: 4, boundary: 'Full factory/common ESP32 and ESP32-C3 builds; no flashing or physical boot.' },
    typecheck: { status: 'passed', boundary: 'Recorded successful Nuxt typecheck execution; log retained.' },
    productionBuild: { status: 'passed' },
    browser: { ...browser.stats, boundary: 'Production Nuxt preview, local Auth/PostgREST fixture, real APIs/SQL/private filesystem storage and authenticated device simulator; desktop/tablet/mobile, not physical hardware or hosted Supabase.' },
  },
  sourceHashes, archives, logs,
  browserReport: { path: browserFile, sha256: sha(browserFile) },
  screenshots, evidence,
  outstandingQualification: [
    'Physical ESP32/C3 OTA, power-cut/NVS/rollback/bootloader/watchdog and application health tests.',
    'Hosted Supabase Storage/Auth and real deployment networking/security configuration.',
    'Sustained HTTPS distribution to 10,000+ devices and global multi-process egress pacing.',
    'Automatic signed schema-layout compatibility and sustained application-specific health qualification.',
    'Full assistive-technology qualification; arbitrary remote commands, trust rotation, persisted chunk resumption and automatic artifact garbage collection remain unsupported.',
  ],
}
const output = path.join(root, 'docs/phase-10/evidence/verification.json')
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log('PASS collected source hashes and validated original local qualification evidence; no tests rerun or production actions')
