// Synthetic device/metric distribution qualification; not enrollment or physical-fleet throughput.
const { setup } = require('./fixture.cjs'),
  { processFrame } = require('../../tcp-server/ingest'),
  { performance } = require('node:perf_hooks'),
  fs = require('node:fs'),
  assert = require('node:assert/strict'),
  { createHash } = require('node:crypto')
async function run() {
  process.env.STRUCT_OBSERVABILITY_ENABLED = 'true'
  const f = await setup(),
    { db, scalar } = f
  const result = {
    timestamp: new Date().toISOString(),
    boundary:
      'Local PGlite; 1 actual authenticated reading plus synthetic fleet metadata and packet counters. Not credential provisioning, physical devices, hosted latency or database CPU.',
    stages: [],
  }
  try {
    await db.query(
      "update organizations set subscription_tier='scale',stripe_quantity=20000 where id=$1",
      [f.org],
    )
    await f.command('preferences', {
      mode: 'scheduled',
      interval: 60,
      grace: 180,
    })
    await processFrame(f.frame(0), {
      supabase: f.adapter,
      transport: 'udp',
      ipVersion: 4,
    })
    const group = await scalar(
      "insert into device_groups(organization_id,name) values($1,'Synthetic outdoors') returning id",
      [f.org],
    )
    const rule = (
      await f.command('rule', {
        name: 'Fleet traffic',
        kind: 'bytes',
        threshold: 1,
        clear: 0,
        enabled: true,
      })
    ).id
    const maximum = Number(process.env.STRUCT_OBSERVABILITY_SCALE_MAX || 10000)
    assert(
      [10000, 100000].includes(maximum),
      'Only bounded 10k/100k synthetic runs are supported',
    )
    let total = 1
    for (const size of [
      10,
      100,
      1000,
      10000,
      ...(maximum === 100000 ? [100000] : []),
    ]) {
      const seed = performance.now()
      await db.query(
        "insert into devices(user_id,organization_id,name,api_key,key_id,external_id,labels,first_telemetry_at,last_monitored_commit_at) select $1,$2,'Synthetic '||g,gen_random_uuid()::text,gen_random_uuid()::text,'obs-'||g,array[case when g%2=0 then 'outdoor' else 'indoor' end],case when g%7=0 then null else now()-interval '1 day' end,case when g%7=0 then null when g%3=0 then now()-interval '1 hour' else now() end from generate_series($3::integer,$4::integer)g",
        [f.user, f.org, total, size - 1],
      )
      await db.query(
        "insert into device_group_members(group_id,device_id,organization_id) select $1,id,$2 from devices where organization_id=$2 and external_id like 'obs-%' and 'outdoor'=any(labels) on conflict do nothing",
        [group, f.org],
      )
      await db.query(
        "insert into metric_events(event_key,organization_id,device_id,kind,group_ids,labels,ip_version,readings,payload_bytes,app_bytes,framing_bytes,security_bytes) select 'synthetic:'||id,$1,id,'commit',case when 'outdoor'=any(labels) then array[$2::uuid] else '{}'::uuid[] end,labels,4,1,1,26,9,16 from devices where organization_id=$1 and external_id like 'obs-%' on conflict do nothing",
        [f.org, group],
      )
      const seedMs = performance.now() - seed,
        begin = performance.now()
      let processed = 0,
        r
      do {
        r = await scalar('select aggregate_metric_events(200)')
        processed += r
      } while (r)
      const aggregateMs = performance.now() - begin
      const measure = async (sql, args) => {
        const times = []
        let data
        for (let i = 0; i < 5; i++) {
          const t = performance.now()
          data = await scalar(sql, args)
          times.push(performance.now() - t)
        }
        times.sort((a, b) => a - b)
        return {
          medianMs: times[2],
          jsonBytes: Buffer.byteLength(JSON.stringify(data)),
        }
      }
      const inventory = await measure('select monitoring_devices($1,$2)', [
          f.org,
          f.user,
        ]),
        usage = await measure(
          "select usage_analytics($1,$2,now()-interval '24 hours',now()+interval '1 minute')",
          [f.org, f.user],
        ),
        groupUsage = await measure(
          "select usage_analytics($1,$2,now()-interval '24 hours',now()+interval '1 minute',$3)",
          [f.org, f.user, JSON.stringify({ group })],
        )
      const evaluation = performance.now()
      await scalar('select evaluate_alert_rule($1)', [rule])
      const alertMs = performance.now() - evaluation
      assert.equal(
        Number(
          await scalar(
            "select sum(readings)::text from usage_rollups where grain='hour'",
          ),
        ),
        size,
      )
      assert(usage.jsonBytes < 100000 && inventory.jsonBytes < 100000)
      result.stages.push({
        devices: size,
        seedMs,
        processed,
        aggregateMs,
        aggregationPerSecond: (processed / aggregateMs) * 1000,
        inventory,
        usage,
        groupUsage,
        alertMs,
      })
      console.log(`Qualified synthetic inventory ${size}`)
      total = size
    }
    result.memory = process.memoryUsage()
    result.migrationSHA256 = createHash('sha256')
      .update(
        fs.readFileSync('supabase/migrations/038_monitoring_analytics.sql'),
      )
      .digest('hex')
    fs.writeFileSync(
      'docs/phase-5-8/evidence/synthetic-scale.json',
      JSON.stringify(result, null, 2) + '\n',
    )
  } finally {
    await db.close()
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
