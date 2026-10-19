const { createDatabase } = require('../database.cjs'),
  { randomUUID } = require('node:crypto'),
  fs = require('node:fs')
;(async () => {
  const results = []
  for (const version of ['035', '036']) {
    const db = await createDatabase(version)
    try {
      const user = randomUUID(),
        org = randomUUID()
      await db.query('insert into auth.users values($1,$2)', [
        user,
        'load@example.invalid',
      ])
      await db.query(
        "insert into organizations(id,name,subscription_tier) values($1,'load','scale')",
        [org],
      )
      await db.query(
        "insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')",
        [org, user],
      )
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ])
      await db.exec('update delivery_pipeline_settings set enabled=true')
      const devices = Array.from({ length: 1000 }, () => randomUUID())
      await db.query(
        "insert into devices(id,user_id,organization_id,name,api_key,key_id) select id,$1,$2,'Simulated',id::text,id::text from unnest($3::uuid[]) id",
        [user, org, devices],
      )
      if (version === '036')
        await db.exec('update integration_settings set enabled=true')
      for (const count of [0, 1, 4]) {
        await db.exec('delete from destinations')
        for (let i = 0; i < count; i++) {
          if (version === '035')
            await db.query(
              "insert into destinations(user_id,organization_id,name,url,signing_secret) values($1,$2,'load','https://example.com/hook','test')",
              [user, org],
            )
          else {
            const id = randomUUID()
            await db.query(
              "select save_integration($1,$2,$3,'load','http',$4,$5,$6,'test-only-unused-cipher',0,false)",
              [
                org,
                user,
                id,
                JSON.stringify({ url: 'https://example.com/hook' }),
                JSON.stringify({
                  field: 'payload.temperature',
                  op: 'gt',
                  value: 20,
                }),
                JSON.stringify({
                  format: 'envelope-v1',
                  fields: [],
                  metadata: [],
                }),
              ],
            )
            await db.query("select integration_action($1,$2,$3,1,'enable')", [
              org,
              user,
              id,
            ])
          }
        }
        const pendingBefore = Number(
          (
            await db.query(
              "select count(*) n from webhook_deliveries where status='pending'",
            )
          ).rows[0].n,
        )
        const samples = [],
          heap = process.memoryUsage(),
          cpu = process.cpuUsage(),
          start = performance.now()
        for (let i = 0; i < 1020; i++) {
          const t = performance.now()
          await db.query(
            'insert into telemetry(device_id,parsed_json) values($1,$2)',
            [
              devices[i % 1000],
              JSON.stringify({
                temperature: 23.5,
                humidity: 61.25,
                is_active: true,
                count: '18446744073709551615',
              }),
            ],
          )
          if (i >= 20) samples.push(performance.now() - t)
        }
        const elapsed = performance.now() - start,
          sorted = samples.toSorted((a, b) => a - b),
          used = process.cpuUsage(cpu)
        results.push({
          migration: version,
          destinations: count,
          unique_simulated_devices: 1000,
          samples: samples.length,
          median_ms: sorted[500],
          p95_ms: sorted[950],
          sql_inserts_per_second: (1020 / elapsed) * 1000,
          total_elapsed_ms: elapsed,
          cpu_user_ms: used.user / 1000,
          cpu_system_ms: used.system / 1000,
          heap_delta_bytes: process.memoryUsage().heapUsed - heap.heapUsed,
          previous_scenario_pending_jobs: pendingBefore,
          queued_jobs:
            Number(
              (
                await db.query(
                  "select count(*) n from webhook_deliveries where status='pending'",
                )
              ).rows[0].n,
            ) - pendingBefore,
          raw_ms: samples,
        })
      }
    } finally {
      await db.close()
    }
  }
  fs.mkdirSync('docs/phase-7/evidence', { recursive: true })
  fs.writeFileSync(
    'docs/phase-7/evidence/performance.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        environment: {
          node: process.version,
          platform: process.platform,
          architecture: process.arch,
          database: 'PGlite single backend',
        },
        boundary:
          'Sequential SQL commit-stage insert benchmark, not UDP ingestion throughput or production capacity. 035 uses legacy unconditional webhooks; 036 uses equivalent fanout with actual decimal routing and versioned snapshots. No external provider latency included.',
        results,
      },
      null,
      2,
    ),
  )
  console.table(results.map(({ raw_ms, ...r }) => r))
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
