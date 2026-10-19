const fs = require('node:fs'),
  { performance } = require('node:perf_hooks'),
  assert = require('node:assert/strict'),
  { createDatabase } = require('../database.cjs'),
  { fixture } = require('../pipelines/fixture.cjs'),
  { setup } = require('./fixture.cjs')
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    totalMs: values.reduce((a, b) => a + b, 0),
  }
}
async function ingest(migration) {
  const db = await createDatabase(migration),
    f = await fixture(db)
  try {
    await db.query(
      "update organizations set subscription_tier='scale',stripe_quantity=20000 where id=$1",
      [f.org],
    )
    for (let i = 0; i < 20; i++) await f.ingest(i)
    const times = []
    for (let i = 20; i < 220; i++) {
      const begin = performance.now(),
        r = await f.ingest(i)
      assert(r)
      times.push(performance.now() - begin)
    }
    return {
      ...summary(times),
      packetsPerSecond:
        times.length / (times.reduce((a, b) => a + b, 0) / 1000),
    }
  } finally {
    await db.close()
  }
}
async function main() {
  const before = await ingest('040'),
    after = await ingest('041'),
    f = await setup()
  try {
    const begin = performance.now()
    const preview = await f.preview(f.definition)
    const previewMs = performance.now() - begin
    await f.admin('confirm', { id: preview, kind: 'firmware', confirm: true })
    const ticks = []
    for (let i = 0; i < 100; i++) {
      const t = performance.now()
      await f.scalar('select management_tick()')
      ticks.push(performance.now() - t)
    }
    const polls = []
    for (let i = 0; i < 20; i++) {
      const t = performance.now()
      await f.deviceRequest('poll')
      polls.push(performance.now() - t)
    }
    const r = {
      at: new Date().toISOString(),
      boundary:
        'Paired disposable PGlite/actual AEAD local microbenchmark, 20 warmup + 200 sequential committed packets per migration. Other local development services may be running. Scheduler 100 calls/one eligible device; authenticated DB+crypto fixture polls 20. Not network/cloud/hardware or fleet capacity.',
      beforeMigration040: before,
      afterMigration041: after,
      rolloutPreviewOneDeviceMs: previewMs,
      scheduler: summary(ticks),
      authenticatedFixturePoll: summary(polls),
      memory: process.memoryUsage(),
      hotPathChange:
        'No management queries or external calls added to telemetry ingestion.',
    }
    fs.writeFileSync(
      'docs/phase-10/evidence/performance.json',
      JSON.stringify(r, null, 2),
    )
    console.log(JSON.stringify(r, null, 2))
  } finally {
    await f.db.close()
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
