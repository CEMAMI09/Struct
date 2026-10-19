const { createDatabase } = require('../database.cjs')
const { performance } = require('node:perf_hooks')
const fs = require('node:fs')
;(async () => {
  const db = await createDatabase(process.argv[2] || '034')
  try {
    const u = '20000000-0000-0000-0000-000000000001',
      o = '20000000-0000-0000-0000-000000000002',
      d = '20000000-0000-0000-0000-000000000003'
    await db.query('insert into auth.users values($1,$2)', [
      u,
      'load@example.invalid',
    ])
    await db.query("insert into organizations(id,name) values($1,'load')", [o])
    await db.query(
      "insert into devices(id,user_id,organization_id,name,api_key,key_id) values($1,$2,$3,'test','load','load')",
      [d, u, o],
    )
    const results = {
      environment: {
        node: process.version,
        platform: process.platform,
        database:
          'PGlite single backend; host timing, not production throughput',
      },
      migration: process.argv[2] || '034',
      cases: [],
    }
    for (const destinations of [0, 1, 4]) {
      await db.exec('delete from destinations')
      for (let i = 0; i < destinations; i++)
        await db.query(
          "insert into destinations(user_id,organization_id,name,url) values($1,$2,'load','https://example.com/hook')",
          [u, o],
        )
      const durations = []
      for (let n = 0; n < 110; n++) {
        const start = performance.now()
        await db.query(
          'insert into telemetry(device_id,parsed_json) values($1,\'{"temp":23.5}\')',
          [d],
        )
        if (n >= 10) durations.push(performance.now() - start)
      }
      const sorted = durations.toSorted((a, b) => a - b),
        sum = durations.reduce((a, b) => a + b, 0)
      results.cases.push({
        destinations,
        samples: 100,
        median_ms: sorted[50],
        p95_ms: sorted[95],
        serial_inserts_per_second: 100000 / sum,
      })
    }
    results.memory = process.memoryUsage()
    fs.writeFileSync(
      process.argv[3] || 'docs/phase-3-4/evidence/baseline.json',
      JSON.stringify(results, null, 2),
    )
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
