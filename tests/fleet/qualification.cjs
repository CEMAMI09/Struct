// Local qualification, real enrollment and serializers. No external services.
const fs = require('node:fs'),
  { randomUUID, createHash } = require('node:crypto'),
  { performance } = require('node:perf_hooks'),
  assert = require('node:assert/strict')
const { fixture } = require('../pipelines/fixture.cjs'),
  { credentials } = require('../../tcp-server/fleet/worker')
async function run() {
  const { csvRows } = await import('../../web/shared/fleet.ts')
  const f = await fixture(),
    { db, scalar } = f
  const result = {
    scope:
      'PGlite local SQL + real credential enrollment; no network RTT or physical devices; old query returns the former full inventory projection',
    registration: [],
    inventory: [],
    csv: [],
    timestamp: new Date().toISOString(),
  }
  const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
  try {
    await db.exec('update fleet_settings set enabled=true')
    await db.query(
      "update organizations set subscription_tier='scale',stripe_quantity=20000 where id=$1",
      [f.org],
    )
    for (const target of [100, 1000, 10000]) {
      const n =
          target -
          Number(
            await scalar(
              'select count(*)::int from devices where organization_id=$1',
              [f.org],
            ),
          ),
        rows = Array.from({ length: n }, (_, i) => ({
          name: `Sensor ${target}-${i}`,
          external_id: `q-${target}-${i}`,
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
      for (let i = 0; i < n; i++) {
        const c = await scalar('select fleet_claim()'),
          s = credentials()
        roots.add(
          require('../../tcp-server/auth').decryptSecret(s.root_encrypted),
        )
        assert.equal(
          await scalar('select fleet_finish($1,$2,$3,$4)', [
            job,
            c.item.item_index,
            c.item.lease_token,
            JSON.stringify(s),
          ]),
          'created',
        )
        if (i && i % 1000 === 0)
          console.log(`Enrolled ${i}/${n} for inventory ${target}`)
      }
      assert.equal(roots.size, n)
      const durationMs = performance.now() - start
      result.registration.push({
        targetInventory: target,
        newSecureDevices: n,
        durationMs,
        devicesPerSecond: (n / durationMs) * 1000,
      })
      const oldTimes = [],
        newTimes = []
      let oldBytes, newBytes
      for (let i = 0; i < 5; i++) {
        let t = performance.now()
        const old = (
          await db.query(
            'select id,user_id,organization_id,name,api_key,key_id,api_secret_preview,protocol_version,mac_address,last_seen,created_at,tags,encryption_enabled,profile_id,hardware_id,secure_v2_enabled,wire_device_id,first_telemetry_at,starter_downloaded_at,configuration_acknowledged_at,expected_report_interval_ms from devices where organization_id=$1 order by created_at desc',
            [f.org],
          )
        ).rows
        oldBytes = Buffer.byteLength(JSON.stringify(old))
        oldTimes.push(performance.now() - t)
        t = performance.now()
        const current = await scalar('select fleet_inventory($1,$2,$3,0,50)', [
          f.org,
          f.user,
          '{}',
        ])
        newBytes = Buffer.byteLength(JSON.stringify(current))
        newTimes.push(performance.now() - t)
        assert(
          current.devices.length === 50 && Number(current.total) === target,
        )
      }
      result.inventory.push({
        devices: target,
        old: {
          medianMs: median(oldTimes),
          returnedRows: target,
          jsonBytes: oldBytes,
        },
        current: {
          medianMs: median(newTimes),
          returnedRows: 50,
          jsonBytes: newBytes,
        },
      })
      console.log(
        `Actual secure inventory ${target}: ${durationMs.toFixed(1)}ms registration; ${oldBytes} -> ${newBytes} response bytes`,
      )
    }
    for (const size of [100, 1000, 10000]) {
      const csv =
          'name,serial_number,metadata\n' +
          Array.from(
            { length: size },
            (_, i) => `Sensor ${i},serial-${i},"{""location"":""north""}"`,
          ).join('\n'),
        times = []
      for (let i = 0; i < 5; i++) {
        const t = performance.now(),
          rows = csvRows(csv, {
            name: 'name',
            serial_number: 'serial_number',
            metadata: 'metadata',
          })
        assert(rows.length === size && rows.every((r) => !r.error))
        times.push(performance.now() - t)
      }
      result.csv.push({
        rows: size,
        bytes: Buffer.byteLength(csv),
        medianMs: median(times),
      })
    }
    let t = performance.now()
    const preview = await scalar('select fleet_preview($1,$2,$3,$4,$5,$6,$7)', [
      f.org,
      f.user,
      randomUUID(),
      'disable',
      '{}',
      '[]',
      '{}',
    ])
    result.filteredPreview10000Ms = performance.now() - t
    assert.equal(
      await scalar(
        'select count(*)::int from fleet_job_items where job_id=$1',
        [preview],
      ),
      10000,
    )
    await scalar("select fleet_job_action($1,$2,$3,'cancel')", [
      f.org,
      f.user,
      preview,
    ])
    result.memory = process.memoryUsage()
    result.migrationSHA256 = createHash('sha256')
      .update(fs.readFileSync('supabase/migrations/037_fleet_management.sql'))
      .digest('hex')
    fs.mkdirSync('docs/phase-6/evidence', { recursive: true })
    fs.writeFileSync(
      'docs/phase-6/evidence/qualification.json',
      JSON.stringify(result, null, 2),
    )
    console.log(JSON.stringify(result))
  } finally {
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
