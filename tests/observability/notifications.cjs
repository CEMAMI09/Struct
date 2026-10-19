const assert = require('node:assert/strict'),
  { setup } = require('./fixture.cjs'),
  { randomUUID } = require('node:crypto')
const { sendEmail } = require('../../tcp-server/observability/worker'),
  { deliver } = require('../../tcp-server/outbox')
async function run() {
  const f = await setup(),
    { db, scalar } = f
  let n = 0
  const check = (v, m) => {
    assert(v, m)
    n++
  }
  try {
    await db.exec(
      'alter table auth.users add column email_confirmed_at timestamptz default now()',
    )
    await db.exec('update delivery_pipeline_settings set enabled=true')
    await f.command('email_preferences', { enabled: true, severity: 'warning' })
    const rule = (
      await f.command('rule', {
        name: 'Factory onboarding',
        kind: 'never_connected',
        threshold: 1,
        clear: 0,
        window: 1,
        enabled: true,
        email: true,
        webhook: f.destination,
      })
    ).id
    await db.query(
      "update devices set created_at=now()-interval '2 minutes' where id=$1",
      [f.device],
    )
    await scalar('select evaluate_alert_rule($1)', [rule])
    await scalar('select evaluate_alert_rule($1)', [rule])
    check(
      (await scalar('select count(*)::int from alert_notifications')) === 2,
      'deduplicated email and shared-outbox webhook',
    )
    const job = (await f.adapter.rpc('claim_alert_email')).data
    check(
      job && job.to === 'pipeline@example.invalid',
      'only verified member account recipient',
    )
    const stale = await scalar("select finish_alert_email($1,$2,'delivered')", [
      job.id,
      randomUUID(),
    ])
    check(stale === false, 'stale lease cannot complete')
    process.env.RESEND_API_KEY = 'local-test-key'
    process.env.STRUCT_ALERT_EMAIL_FROM = 'Struct <alerts@example.invalid>'
    let calls = 0
    const fake = async (url, init) => {
      calls++
      check(
        url === 'https://api.resend.com/emails' && init.redirect === 'error',
        'fixed secure provider endpoint',
      )
      check(
        init.headers['idempotency-key'] === 'struct-alert-' + job.id,
        'stable provider idempotency',
      )
      check(!init.body.includes(f.root), 'email no credential content')
      return new Response('', {
        status: calls === 1 ? 503 : 200,
        headers: { 'retry-after': '3' },
      })
    }
    const first = await sendEmail(job, fake)
    check(
      first.outcome === 'retry' && first.after === 3,
      'temporary provider retry classification',
    )
    await f.adapter.rpc('finish_alert_email', {
      p_id: job.id,
      p_token: job.token,
      p_outcome: first.outcome,
      p_category: first.category,
      p_status: first.status,
      p_after: 0,
    })
    check(
      (await scalar(
        "select count(*)::int from alert_incidents where status='open'",
      )) === 1,
      'notification failure preserves incident',
    )
    await db.exec(
      "update alert_notifications set available_at=now()-interval '1 second' where channel='email'",
    )
    const second = (await f.adapter.rpc('claim_alert_email')).data,
      r = await sendEmail(second, fake)
    await f.adapter.rpc('finish_alert_email', {
      p_id: second.id,
      p_token: second.token,
      p_outcome: r.outcome,
      p_category: r.category,
      p_status: r.status,
      p_after: 0,
    })
    check(
      (await scalar(
        "select status from alert_notifications where channel='email'",
      )) === 'delivered',
      'notification recovers',
    )
    check(
      (await scalar(
        'select count(*)::int from alert_notification_attempts',
      )) === 2,
      'attempt history retained',
    )
    const jobs = (
      await f.adapter.rpc('claim_webhook_deliveries_v2', { p_limit: 8 })
    ).data
    check(jobs.length === 1, 'alert uses original reliable claimant')
    await deliver(
      f.adapter,
      jobs[0],
      async (_url, body, headers) => {
        check(
          JSON.parse(body).type === 'alert.opened' &&
            !!headers['x-struct-signature'],
          'compatible signed alert envelope',
        )
        return { status: 200, ok: true }
      },
      { pipelineV2: true },
    )
    check(
      (await scalar(
        "select count(*)::int from metric_events where kind like 'delivery_%'",
      )) === 0,
      'notification delivery cannot feed telemetry failure alerts',
    )
    await f.command('email_preferences', {
      enabled: false,
      severity: 'warning',
    })
    await scalar("select alert_schedule_notifications($1,'resolved')", [
      await scalar('select id from alert_incidents'),
    ])
    check(
      (await scalar(
        "select count(*)::int from alert_notifications where channel='email'",
      )) === 1,
      'opt-out respected',
    )
    await db.exec("create function fail_alert_schedule() returns trigger language plpgsql as $$begin raise exception 'notification scheduling outage';end$$;create trigger fail_alert_scheduling before insert on webhook_deliveries for each row execute function fail_alert_schedule()")
    const failedRule=(await f.command('rule',{name:'Schedule outage',kind:'never_connected',threshold:1,clear:0,window:1,enabled:true,webhook:f.destination})).id
    await scalar('select evaluate_alert_rule($1)',[failedRule])
    check(await scalar("select status from alert_incidents where rule_id=$1",[failedRule])==='open','failed scheduling cannot erase durable incident')
    check(await scalar("select notification_suppressed_reason from alert_incidents where rule_id=$1",[failedRule])==='notification_schedule_failed','scheduling failure visible independently')
    const failedIncident=await scalar('select id from alert_incidents where rule_id=$1',[failedRule])
    check(await scalar('select notify_pending from alert_transitions where incident_id=$1',[failedIncident])===true,'scheduling intent durably pending')
    await f.command('resolve',{id:failedIncident})
    const replacement=await scalar("insert into destinations(user_id,organization_id,name,url,signing_secret) values($1,$2,'New route','https://example.com/new','local-secret') returning id",[f.user,f.org])
    await f.command('rule',{id:failedRule,version:1,name:'Changed future rule',kind:'never_connected',threshold:1,clear:0,window:1,enabled:true,webhook:replacement})
    await db.exec('drop trigger fail_alert_scheduling on webhook_deliveries')
    await db.query("update alert_transitions set notification_next_at=now()-interval '1 second' where incident_id=$1",[failedIncident]);await scalar('select retry_alert_notifications()')
    check(await scalar('select count(*)::int from alert_transitions where incident_id=$1 and notify_pending',[failedIncident])===0,'intent recovers automatically')
    check(await scalar('select count(*)::int from alert_notifications a join webhook_deliveries w on w.id=a.delivery_id where a.incident_id=$1 and w.destination_id=$2',[failedIncident,f.destination])===2,'pending decisions retain original destination after rule edit')
    console.log(
      `PASS ${n} notification retry/signing/preferences/loop prevention checks`,
    )
  } finally {
    await db.close()
    delete process.env.RESEND_API_KEY
    delete process.env.STRUCT_ALERT_EMAIL_FROM
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
