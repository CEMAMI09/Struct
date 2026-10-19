const assert = require('node:assert/strict'),
  { setup } = require('./fixture.cjs'),
  { randomUUID } = require('node:crypto')
const { processFrame } = require('../../tcp-server/ingest'),
  collector = require('../../tcp-server/observability/collector')
async function run() {
  process.env.STRUCT_OBSERVABILITY_ENABLED = 'true'
  const f = await setup(),
    { db, scalar } = f
  let n = 0
  const check = (v, m) => {
    assert(v, m)
    n++
  }
  const reject = async (p, re) => {
    await assert.rejects(p, re)
    n++
  }
  const evaluate = (id, at) =>
    scalar('select evaluate_alert_rule($1,$2)', [
      id,
      new Date(at).toISOString(),
    ])
  try {
    await processFrame(f.frame(0), {
      supabase: f.adapter,
      transport: 'udp',
      ipVersion: 6,
    })
    await db.exec(
      "create function fail_rollup() returns trigger language plpgsql as $$begin raise exception 'rollup outage';end$$;create trigger inject_rollup before insert on usage_rollups for each row execute function fail_rollup()",
    )
    await reject(scalar('select aggregate_metric_events(100)'), /rollup outage/)
    check(
      (await scalar('select processed_at is null from metric_events')) === true,
      'failed aggregation retains durable pending event',
    )
    await db.exec('drop trigger inject_rollup on usage_rollups')
    await scalar('select aggregate_metric_events(100)')
    await scalar('select aggregate_metric_events(100)')
    check(
      (await scalar(
        "select sum(readings)::int from usage_rollups where grain='hour'",
      )) === 1,
      'restart processes once',
    )
    const now = Date.now(),
      rule = (
        await f.command('rule', {
          name: 'Held traffic',
          kind: 'bytes',
          threshold: 1,
          clear: 0,
          window: 60,
          hold: 120,
          cooldown: 300,
          enabled: true,
        })
      ).id
    await evaluate(rule, now)
    await evaluate(rule, now + 119000)
    check(
      (await scalar('select count(*)::int from alert_incidents')) === 0,
      'minimum duration prevents early trigger',
    )
    await evaluate(rule, now + 121000)
    check(
      (await scalar('select count(*)::int from alert_incidents')) === 1,
      'held condition opens once',
    )
    await f.command('mute', {
      id: rule,
      until: new Date(now + 180000).toISOString(),
    })
    await evaluate(rule, now + 122000)
    check(
      (await scalar('select status from alert_incidents')) === 'suppressed',
      'mute suppresses existing incident',
    )
    await evaluate(rule, now + 181000)
    check(
      (await scalar('select status from alert_incidents')) === 'open',
      'expiry resumes actual incident',
    )
    await f.command('preferences', {
      mode: 'none',
      interval: 60,
      grace: 0,
      maintenance: new Date(now + 600000).toISOString(),
    })
    await evaluate(rule, now + 182000)
    check(
      (await scalar('select status from alert_incidents')) === 'suppressed',
      'workspace maintenance suppression',
    )
    await f.command('preferences', {
      mode: 'none',
      interval: 60,
      grace: 0,
      maintenance: null,
    })
    await db.exec("update usage_rollups set app_bytes=0 where grain='minute'")
    await evaluate(rule, now + 183000)
    await evaluate(rule, now + 304000)
    check(
      (await scalar('select status from alert_incidents')) === 'resolved',
      'recovery hold required',
    )
    await db.exec("update usage_rollups set app_bytes=26 where grain='minute'")
    await evaluate(rule, now + 305000)
    await evaluate(rule, now + 426000)
    check(
      (await scalar('select count(*)::int from alert_incidents')) === 1,
      'cooldown blocks flap',
    )
    await evaluate(rule, now + 605000)
    check(
      (await scalar('select count(*)::int from alert_incidents')) === 2,
      'cooldown eventually allows distinct incident',
    )
    const missing = (
      await f.command('rule', {
        name: 'No scalar',
        kind: 'sensor',
        device: f.device,
        field: 'missing',
        threshold: 0,
        clear: 0,
        comparator: 'lte',
        enabled: true,
      })
    ).id
    await evaluate(missing, now)
    check(
      (await scalar('select last_value is null from alert_rules where id=$1', [
        missing,
      ])) === true,
      'missing field unavailable, not zero',
    )
    await reject(
      f.command('rule', {
        name: 'Group sensor',
        kind: 'sensor',
        field: 'value',
        threshold: 1,
        clear: 0,
      }),
      /check constraint/,
    )
    process.env.STRUCT_OBSERVABILITY_ENABLED = 'false'
    await f.ingest(1)
    process.env.STRUCT_OBSERVABILITY_ENABLED = 'true'
    const backfilled = await scalar('select observability_backfill($1,$2)', [
      f.org,
      f.user,
    ])
    check(backfilled.inserted === 1, 'explicit historical reading backfill')
    await scalar('select aggregate_metric_events(100)')
    await db.exec('delete from metric_events where processed_at is not null')
    check(
      (await scalar('select observability_backfill($1,$2)', [f.org, f.user]))
        .inserted === 0,
      'dedup ledger survives raw metric cleanup',
    )
    const usage = await scalar(
      "select usage_analytics($1,$2,now()-interval '1 hour',now()+interval '1 minute')",
      [f.org, f.user],
    )
    check(usage.buckets[0].unknown === '1', 'historical bytes unknown')
    const other = randomUUID()
    await db.query('insert into organizations(id,name) values($1,$2)', [
      other,
      'Unrelated',
    ])
    await db.query(
      "insert into usage_rollups(organization_id,grain,bucket,dimension,kind,group_ids,labels,app_bytes) values($1,'hour',now(),'private','commit','{}','{}',999)",
      [other],
    )
    await db.exec('set role authenticated')
    check(
      (await scalar(
        'select count(*)::int from usage_rollups where organization_id=$1',
        [other],
      )) === 0,
      'tenant RLS hides unrelated counters',
    )
    await reject(db.exec('select claim_alert_email()'), /permission denied/)
    await reject(
      db.exec('select notification_config from alert_incidents'),
      /permission denied/,
    )
    await db.exec('reset role')
    await reject(
      scalar("select usage_analytics($1,$2,now()-interval '400 days',now())", [
        f.org,
        f.user,
      ]),
      /INVALID_WINDOW/,
    )
    let tries = 0,
      firstId
    const fake = {
      rpc: async (_name, args) => {
        tries++
        firstId ??= args.p_rows[0].id
        assert(
          Number.isFinite(Date.parse(args.p_rows[0].observed_at)),
          'observation time is captured before asynchronous persistence',
        )
        check(
          args.p_rows[0].id === firstId,
          'observation retry identity stable',
        )
        return tries === 1 ? { error: { message: 'outage' } } : { data: 1 }
      },
    }
    collector.observe(fake, {
      device_id: f.device,
      kind: 'duplicate',
      app_bytes: 26,
      receipt_bytes: 0,
      ip_version: 4,
    })
    await collector.flush(fake)
    await collector.flush(fake)
    check(tries === 2, 'bounded collector recovers temporary database failure')
    await scalar('select observability_tick(200)')
    check(
      (await scalar('select count(*)::int from monitoring_health_history')) >=
        1,
      'durable hourly health snapshot',
    )
    await db.query(
      "insert into metric_events(event_key,organization_id,kind,observed_at,readings,app_bytes) values($1,$2,'commit',now()-interval '8 days',1,26)",
      ['expiry-fixture-' + randomUUID(), f.org],
    )
    await scalar('select observability_cleanup()')
    check(
      (await scalar(
        "select count(*)::int from metric_gaps where organization_id=$1 and cause='ingress_aggregation_expired'",
        [f.org],
      )) === 1,
      'expired pending observation records coverage gap',
    )
    check(
      (await scalar(
        "select count(*)::int from metric_events where observed_at<now()-interval '7 days' and processed_at is null",
      )) === 0,
      'expired pending observation removed after gap recorded',
    )
    const request = {
      id: randomUUID(),
      version: 0,
      name: 'Stable create request',
      kind: 'bytes',
      threshold: '1',
      clear: '0',
      enabled: false,
    }
    const created = await f.command('rule', request)
    const retried = await f.command('rule', request)
    check(
      created.id === retried.id &&
        (await scalar('select version from alert_rules where id=$1', [
          created.id,
        ])) === 1,
      'ambiguous rule creation retry is idempotent',
    )
    await f.command('rule', { ...request, version: 1, name: 'New definition' })
    await reject(f.command('rule', request), /VERSION_CONFLICT/)
    const count = await scalar(
      'select count(*)::int from alert_rules where organization_id=$1 and deleted_at is null',
      [f.org],
    )
    await db.query(
      "insert into alert_rules(organization_id,name,kind,threshold,clear_threshold) select $1,'Limit fixture '||g,'bytes',1,0 from generate_series(1,$2::integer)g",
      [f.org, 100 - count],
    )
    await reject(
      f.command('rule', { ...request, id: randomUUID() }),
      /RULE_LIMIT/,
    )
    console.log(
      `PASS ${n} fault/hold/cooldown/maintenance/backfill/RLS/recovery checks`,
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
