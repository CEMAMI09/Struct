const assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto'),
  { setup } = require('./fixture.cjs')
const { processFrame } = require('../../tcp-server/ingest'),
  wire = require('../../sdk/js/secure-v2.cjs'),
  { flush, health } = require('../../tcp-server/observability/collector')
async function run() {
  process.env.STRUCT_OBSERVABILITY_ENABLED = 'true'
  const f = await setup(),
    { db, scalar } = f
  let count = 0
  const check = (v, m) => {
    assert(v, m)
    count++
  }
  const reject = async (p, re) => {
    await assert.rejects(p, re)
    count++
  }
  try {
    const r = await processFrame(f.frame(0, [1, 2, 3]), {
      supabase: f.adapter,
      transport: 'udp',
      ipVersion: 4,
    })
    check(
      r.records.length === 3 &&
        wire.verifyReceipt(r.receipt, f.root, f.wireId, 0),
      'real AEAD batch committed receipt',
    )
    check(
      (await scalar('select count(*)::int from metric_events')) === 1,
      'one metric per batch',
    )
    check(
      (await scalar(
        "select app_bytes::int from metric_events where kind='commit'",
      )) === 29,
      'batch actual frame bytes',
    )
    check(
      (await scalar('select readings::int from metric_events')) === 3,
      'logical readings',
    )
    await processFrame(f.frame(0, [1, 2, 3]), {
      supabase: f.adapter,
      transport: 'udp',
      ipVersion: 4,
    })
    await flush(f.adapter)
    check(
      (await scalar(
        "select count(*)::int from metric_events where kind='duplicate'",
      )) === 1,
      'duplicate attempt counted separately',
    )
    const bad = f.frame(1)
    bad[bad.length - 1] ^= 1
    await reject(
      processFrame(bad, {
        supabase: f.adapter,
        transport: 'udp',
        ipVersion: 4,
      }),
      /authentication/,
    )
    check(health.unattributed === 1, 'bad AEAD not assigned to tenant')
    check(
      (await scalar('select count(*)::int from metric_events')) === 2,
      'unauthenticated input creates no device metric',
    )
    await scalar('select aggregate_metric_events(100)')
    await scalar('select aggregate_metric_events(100)')
    check(
      (await scalar(
        "select sum(readings)::int from usage_rollups where grain='hour'",
      )) === 3,
      'aggregate retry no double count',
    )
    check(
      (await scalar(
        "select sum(packets)::int from usage_rollups where grain='hour'",
      )) === 2,
      'attempts distinct from readings',
    )
    const usage = await scalar(
      "select usage_analytics($1,$2,now()-interval '1 hour',now()+interval '1 minute')",
      [f.org, f.user],
    )
    check(
      usage.buckets[0].application === '58' &&
        usage.buckets[0].ip_overhead === '56',
      'observed bytes + calculated base headers',
    )
    check(usage.carrier === null, 'carrier unavailable')
    await f.command('preferences', {
      mode: 'scheduled',
      interval: 60,
      grace: 180,
    })
    await db.query(
      "update devices set last_monitored_commit_at=now()-interval '6 minutes' where id=$1",
      [f.device],
    )
    const rule = (
      await f.command('rule', {
        name: 'No reports',
        kind: 'inactivity',
        threshold: 1,
        clear: 0,
        enabled: true,
        device: f.device,
        webhook: f.destination,
      })
    ).id
    await scalar('select evaluate_alert_rule($1)', [rule])
    await scalar('select evaluate_alert_rule($1)', [rule])
    check(
      (await scalar('select count(*)::int from alert_incidents')) === 1,
      'scheduled evaluator without packets deduplicates',
    )
    check(
      (await scalar('select count(*)::int from alert_notifications')) === 1,
      'webhook notification queued once',
    )
    const incident = await scalar('select id from alert_incidents')
    await f.command('acknowledge', { id: incident })
    check(
      (await scalar('select status from alert_incidents')) === 'acknowledged',
      'ack not resolved',
    )
    await processFrame(f.frame(2), {
      supabase: f.adapter,
      transport: 'udp',
      ipVersion: 6,
    })
    await scalar('select evaluate_alert_rule($1)', [rule])
    check(
      (await scalar('select status from alert_incidents')) === 'resolved',
      'successful reporting recovers inactivity',
    )
    await f.command('policy', {
      device: f.device,
      mode: 'event',
      interval: 60,
      grace: 0,
    })
    await db.query(
      "update devices set last_monitored_commit_at=now()-interval '6 days' where id=$1",
      [f.device],
    )
    await scalar("select evaluate_alert_rule($1,now()+interval '1 day')", [
      rule,
    ])
    check(
      (await scalar(
        "select count(*)::int from alert_incidents where status<>'resolved'",
      )) === 0,
      'event-driven device has no missing report alert',
    )
    await reject(
      f.command('policy', {
        device: randomUUID(),
        mode: 'scheduled',
        interval: 60,
        grace: 0,
      }),
      /FORBIDDEN/,
    )
    await reject(
      scalar('select monitoring_devices($1,$2)', [randomUUID(), f.user]),
      /FORBIDDEN/,
    )
    await reject(
      f.command('rule', {
        name: 'bad',
        kind: 'bytes',
        threshold: 10,
        clear: 20,
      }),
      /HYSTERESIS/,
    )
    await db.exec('set role authenticated')
    await reject(
      db.exec('select aggregate_metric_events(10)'),
      /permission denied/,
    )
    await reject(
      db.exec('update devices set last_monitored_commit_at=now()'),
      /permission denied/,
    )
    await db.exec('reset role')
    const overview = await scalar('select observability_overview($1,$2)', [
      f.org,
      f.user,
    ])
    check(overview.total === '1', 'safe overview')
    check(!JSON.stringify(overview).includes(f.root), 'no secret exposure')
    await scalar('select aggregate_metric_events(100)')
    const before = await scalar(
      "select sum(readings)::text from usage_rollups where grain='hour'",
    )
    await scalar('select observability_backfill($1,$2)', [f.org, f.user])
    await scalar('select aggregate_metric_events(100)')
    check(
      (await scalar(
        "select sum(readings)::text from usage_rollups where grain='hour'",
      )) === before,
      'backfill excludes live packet commits',
    )
    await db.exec('delete from telemetry')
    check(
      (await scalar(
        'select last_monitored_commit_at is not null from devices',
      )) === true,
      'retention preserves activity',
    )
    console.log(
      `PASS ${count} observability SQL/gateway/accounting/alert/security checks`,
    )
  } finally {
    await db.exec('reset role')
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
