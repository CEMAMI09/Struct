// 1,000 seeded local simulated device records, no production or physical fleet.
const assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  fs = require('node:fs'),
  { performance } = require('node:perf_hooks'),
  { setup } = require('./fixture.cjs'),
  { encryptSecret } = require('../../tcp-server/auth')
async function main() {
  const f = await setup(),
    samples = [{ id: f.device, wire: f.wireId, root: f.root }],
    start = performance.now()
  try {
    const ids = [],
      roots = [],
      tokens = [],
      names = [],
      api = []
    for (let i = 1; i < 1000; i++) {
      ids.push(crypto.randomUUID())
      const root = crypto.randomBytes(32).toString('hex')
      roots.push(encryptSecret(root))
      tokens.push(encryptSecret(crypto.randomBytes(32).toString('hex')))
      names.push('management-load-' + i)
      api.push(crypto.randomUUID())
      samples.push({ id: ids.at(-1), root })
    }
    await f.db.query(
      'insert into devices(id,user_id,organization_id,name,api_key,key_id) select x.id,$1,$2,x.name,x.key,x.key from unnest($3::uuid[],$4::text[],$5::text[]) x(id,name,key)',
      [f.user, f.org, ids, names, api],
    )
    const registered = await f.db.query(
      "insert into secure_v2_credentials(device_id,root_secret_encrypted,secret_preview,bootstrap_token_encrypted,bootstrap_token_hash) select x.id,x.root,'test',x.token,decode(repeat('ab',32),'hex') from unnest($1::uuid[],$2::text[],$3::text[]) x(id,root,token) returning device_id,wire_device_id",
      [ids, roots, tokens],
    )
    const byId = new Map(
      registered.rows.map((r) => [r.device_id, Number(r.wire_device_id)]),
    )
    for (const d of samples.slice(1)) d.wire = byId.get(d.id)
    await f.db.query(
      'update devices d set wire_device_id=c.wire_device_id,secure_v2_enabled=true from secure_v2_credentials c where c.device_id=d.id and d.organization_id=$1',
      [f.org],
    )
    await f.db.query(
      'insert into device_management_profiles(device_id,organization_id,wire_device_id,capabilities,enabled) select d.id,d.organization_id,d.wire_device_id,$2,true from devices d where d.organization_id=$1 on conflict(device_id) do nothing',
      [f.org, JSON.stringify(f.capabilities)],
    )
    const setupMs = performance.now() - start,
      cfg = {
        reportIntervalSeconds: 300,
        sampleIntervalSeconds: 60,
        diagnosticLevel: 'error',
      },
      t = performance.now(),
      rollout = await f.preview({
        kind: 'configuration',
        configuration: cfg,
        selection: { all: true },
        wavePercentages: [100],
        manualAdvance: false,
        observationSeconds: 0,
        maxConcurrent: 100,
        perMinute: 1000,
      })
    const previewMs = performance.now() - t
    assert.equal(
      await f.scalar(
        'select count(*)::int from rollout_targets where rollout_id=$1',
        [rollout],
      ),
      1000,
    )
    await f.admin('confirm', {
      id: rollout,
      kind: 'configuration',
      confirm: true,
    })
    const dispatchStart = performance.now(),
      tickTimes = []
    let dispatched = 0
    for (let round = 0; round < 10; round++) {
      const before = performance.now(),
        r = await f.scalar('select management_tick(100)')
      tickTimes.push(performance.now() - before)
      assert.equal(r.scheduled, 100)
      dispatched += r.scheduled
      const ops = (
        await f.db.query(
          "select * from device_operations where rollout_id=$1 and state='available'",
          [rollout],
        )
      ).rows
      for (const op of ops) {
        const identity = samples.find((s) => s.id === op.device_id)
        await f.deviceRequest('poll', {}, identity)
        await f.deviceRequest(
          'report',
          {
            id: op.id,
            generation: Number(op.generation),
            stage: 'applied',
            configuration: cfg,
          },
          identity,
        )
      }
    }
    await f.scalar('select management_tick()')
    assert.equal(
      await f.scalar('select state from firmware_rollouts where id=$1', [
        rollout,
      ]),
      'completed',
    )
    assert.equal(
      await f.scalar(
        'select count(*)::int from device_operations where rollout_id=$1',
        [rollout],
      ),
      1000,
    )
    const query = performance.now(),
      overview = await f.scalar('select management_overview($1,$2,0)', [
        f.org,
        f.user,
      ]),
      overviewMs = performance.now() - query
    assert.equal(overview.profiles.length, 50)
    assert.equal(overview.operations.length, 50)
    const result = {
      at: new Date().toISOString(),
      devices: 1000,
      seedMs: setupMs,
      previewMs,
      schedulerCalls: tickTimes.length,
      schedulerMeanMs: tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length,
      dispatchAndAuthenticatedSimulatorReportsMs:
        performance.now() - dispatchStart,
      dispatched,
      overviewMs,
      overviewBytes: Buffer.byteLength(JSON.stringify(overview)),
      memory: process.memoryUsage(),
      boundary:
        'Seeded 1,000 independent CSPRNG encrypted roots and local PGlite profiles; ten bounded scheduling transactions and 2,000 HKDF/HMAC+nonce-validated DB simulator actions. No external HTTPS, hardware, cloud, real firmware flash or production-capacity claim.',
    }
    fs.writeFileSync(
      'docs/phase-10/evidence/scale.json',
      JSON.stringify(result, null, 2),
    )
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await f.db.close()
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
