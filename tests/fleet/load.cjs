const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  { performance } = require('node:perf_hooks'),
  { randomUUID } = require('node:crypto')
const { fixture } = require('../pipelines/fixture.cjs'),
  { credentials } = require('../../tcp-server/fleet/worker')
async function run() {
  const f = await fixture(),
    { db, scalar } = f,
    results = {
      environment:
        'Windows Node/PGlite; local SQL engine, not Supabase/network/physical fleet',
      registration: [],
      inventory: [],
    }
  try {
    await db.exec('update fleet_settings set enabled=true')
    await db.query(
      "update organizations set subscription_tier='scale',stripe_quantity=100000 where id=$1",
      [f.org],
    )
    for (const size of [1, 10, 100, 1000]) {
      const rows = Array.from({ length: size }, (_, i) => ({
          name: `unit-${size}-${i}`,
          external_id: `ext-${size}-${i}`,
        })),
        start = performance.now()
      const job = await scalar('select fleet_preview($1,$2,$3,$4,$5,$6,null)', [
        f.org,
        f.user,
        randomUUID(),
        'create',
        '{}',
        JSON.stringify(rows),
      ])
      await scalar("select fleet_job_action($1,$2,$3,'confirm')", [
        f.org,
        f.user,
        job,
      ])
      const roots = new Set()
      for (let i = 0; i < size; i++) {
        const claim = await scalar('select fleet_claim()'),
          secret = credentials()
        roots.add(secret.root_encrypted)
        assert.equal(
          await scalar('select fleet_finish($1,$2,$3,$4)', [
            job,
            claim.item.item_index,
            claim.item.lease_token,
            JSON.stringify(secret),
          ]),
          'created',
        )
      }
      assert.equal(roots.size, size)
      const ms = performance.now() - start
      results.registration.push({
        devices: size,
        ms,
        devicesPerSecond: (size / ms) * 1000,
      })
      console.log(`Secure enrollment ${size}: ${ms.toFixed(1)} ms`)
    }
    for (const size of [10000, 100000]) {
      const existing = await scalar(
          'select count(*)::int from devices where organization_id=$1',
          [f.org],
        ),
        n = size - existing
      const start = performance.now()
      await db.query(
        "insert into devices(user_id,organization_id,name,api_key,key_id,external_id,labels) select $1,$2,'Inventory '||g,gen_random_uuid()::text,gen_random_uuid()::text,'load-'||$3||'-'||g,array[case when g%2=0 then 'outdoor' else 'indoor' end] from generate_series(1,$4::integer)g",
        [f.user, f.org, size, n],
      )
      const seedMs = performance.now() - start
      const measures = []
      for (const filter of [
        {},
        { search: 'Inventory 12' },
        { labels: ['outdoor'] },
        { sort: 'name' },
      ]) {
        const times = []
        for (let i = 0; i < 5; i++) {
          const t = performance.now()
          const result = await scalar('select fleet_inventory($1,$2,$3,0,50)', [
            f.org,
            f.user,
            JSON.stringify(filter),
          ])
          assert(result.devices.length <= 50)
          times.push(performance.now() - t)
        }
        times.sort((a, b) => a - b)
        measures.push({ filter, medianMs: times[2], maxMs: times.at(-1) })
      }
      results.inventory.push({ devices: size, seedMs, measures })
      console.log(`Inventory ${size}: ${JSON.stringify(measures)}`)
    }
    results.memory = process.memoryUsage()
    results.timestamp = new Date().toISOString()
    fs.mkdirSync('docs/phase-6/evidence', { recursive: true })
    fs.writeFileSync(
      'docs/phase-6/evidence/load.json',
      JSON.stringify(results, null, 2),
    )
  } finally {
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
