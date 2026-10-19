const assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto'),
  { fixture } = require('./fixture.cjs'),
  { deliver } = require('../../tcp-server/outbox')
const fs = require('node:fs')
let checks = 0
function check(value, message) {
  assert(value, message)
  checks++
}
;(async () => {
  const f = await fixture(),
    { db, scalar, org, user, destination, ingest, adapter } = f
  try {
    await assert.rejects(
      db.query('select * from claim_webhook_deliveries_v2(8)'),
      /DISABLED/,
    )
    checks++
    await db.exec('update delivery_pipeline_settings set enabled=true')
    const first = await ingest(0),
      duplicate = await ingest(0)
    check(first.receipt.length === 21, 'real Secure V2 commit receipt')
    check(duplicate.eventIds[0] === first.eventIds[0], 'stable UUID')
    check(
      (await scalar('select count(*)::integer from webhook_deliveries')) === 1,
      'one logical delivery',
    )
    check(
      (await scalar('select count(*)::integer from telemetry_events')) === 1,
      'one durable event',
    )
    check(
      (await scalar('select schema_slot from telemetry_events')) === 0,
      'schema correlation',
    )
    await db.exec(
      'update delivery_pipeline_settings set max_pending_per_tenant=1',
    )
    await assert.rejects(ingest(1), /BACKLOG_CAPACITY/)
    checks++
    check(
      (await scalar('select count(*)::integer from telemetry')) === 1,
      'capacity failure rolls back storage',
    )
    await db.exec(
      'update delivery_pipeline_settings set max_pending_per_tenant=100000',
    )
    await db.exec(
      "create function fail_pipeline() returns trigger language plpgsql as $$begin raise exception 'injected outbox outage';end$$;create trigger fail_pipeline before insert on webhook_deliveries for each row execute function fail_pipeline();",
    )
    await assert.rejects(ingest(1), /outbox outage/)
    checks++
    check(
      (await scalar('select highest_sequence from secure_v2_replay_state')) ===
        '0' ||
        Number(
          await scalar('select highest_sequence from secure_v2_replay_state'),
        ) === 0,
      'window rolled back',
    )
    check(
      (await scalar('select count(*)::integer from telemetry_events')) === 1,
      'event metadata rolled back',
    )
    await db.exec('drop trigger fail_pipeline on webhook_deliveries')
    await ingest(1, [10, 11])
    check(
      (await scalar('select count(*)::integer from webhook_deliveries')) === 3,
      'per-reading batch delivery',
    )
    const claim = async () =>
      (await db.query('select * from claim_webhook_deliveries_v2(8)')).rows
    let jobs = await claim()
    check(jobs.length === 1, 'global endpoint concurrency=1')
    const job = jobs[0]
    check(
      (await scalar(
        'select outcome from webhook_attempts where delivery_id=$1',
        [job.id],
      )) === 'dispatching',
      'attempt durable at claim',
    )
    check((await claim()).length === 0, 'no duplicate claim')
    // Remote 503 is classified and Retry-After is persisted and applied to endpoint pacing.
    await deliver(
      adapter,
      job,
      async () => ({ status: 503, retryAfter: '120' }),
      { pipelineV2: true },
    )
    let current = await scalar(
      'select row_to_json(w) from webhook_deliveries w where id=$1',
      [job.id],
    )
    check(
      current.status === 'pending' &&
        current.error_category === 'http_transient',
      '503 retry',
    )
    check(
      Date.parse(current.next_attempt_at) - Date.now() > 115000,
      'Retry-After respected',
    )
    check(
      (await scalar(
        'select http_status from webhook_attempts where delivery_id=$1',
        [job.id],
      )) === 503,
      'structured HTTP recorded',
    )
    await db.query(
      'update webhook_deliveries set next_attempt_at=now() where id=$1',
      [job.id],
    )
    await db.exec(
      'update webhook_destination_runtime set next_dispatch_at=now()',
    )
    jobs = await claim()
    const crash = jobs[0]
    await db.query(
      "update webhook_deliveries set next_attempt_at=now()+interval '1 hour' where id<>$1",
      [crash.id],
    )
    await db.query(
      "update webhook_deliveries set lease_until=now()-interval '1 second' where id=$1",
      [crash.id],
    )
    await db.exec(
      'update webhook_destination_runtime set next_dispatch_at=now()',
    )
    const recovered = (await claim())[0]
    check(
      recovered.id === crash.id && recovered.lease_token !== crash.lease_token,
      'abandoned claim recovered',
    )
    check(
      (await scalar('select finish_webhook_delivery_v2($1,$2,$3)', [
        crash.id,
        crash.lease_token,
        'delivered',
      ])) === false,
      'stale token fenced',
    )
    check(
      (await scalar(
        "select count(*)::integer from webhook_attempts where delivery_id=$1 and outcome='unknown'",
        [crash.id],
      )) === 1,
      'crash ambiguity preserved',
    )
    await deliver(adapter, recovered, async () => ({ status: 401 }), {
      pipelineV2: true,
    })
    current = await scalar(
      'select row_to_json(w) from webhook_deliveries w where id=$1',
      [recovered.id],
    )
    check(
      current.status === 'dead' && current.http_status === 401,
      '401 permanent dead letter',
    )
    const request = randomUUID(),
      recovery = () =>
        scalar('select delivery_recovery($1,$2,$3,$4,true)', [
          org,
          [current.id],
          'retry',
          request,
        ])
    check((await recovery()).scheduled === 1, 'manual retry queued')
    check((await recovery()).duplicate_request, 'recovery idempotent')
    check(
      (await scalar('select replay_count from webhook_deliveries where id=$1', [
        current.id,
      ])) === 1,
      'no duplicate recovery increment',
    )
    check(
      (await scalar('select count(*)::integer from delivery_actions')) === 1,
      'recovery audit',
    )
    await assert.rejects(
      db.query('select delivery_recovery($1,$2,$3,$4,true)', [
        org,
        [current.id],
        'cancel',
        request,
      ]),
      /CONFLICT/,
    )
    checks++
    const pauseRequest = randomUUID()
    await db.query('select pause_webhook_destination($1,true,$2)', [
      destination,
      pauseRequest,
    ])
    check((await claim()).length === 0, 'paused preserves queue')
    await assert.rejects(
      db.query('select pause_webhook_destination($1,false,$2)', [
        destination,
        pauseRequest,
      ]),
      /CONFLICT/,
    )
    checks++
    await db.query('select pause_webhook_destination($1,false,$2)', [
      destination,
      randomUUID(),
    ])
    await db.exec(
      'update webhook_destination_runtime set next_dispatch_at=now()',
    )
    const success = (await claim())[0]
    await deliver(adapter, success, async () => ({ status: 204 }), {
      pipelineV2: true,
    })
    check(
      (await scalar('select status from webhook_deliveries where id=$1', [
        success.id,
      ])) === 'delivered',
      'eventual success',
    )
    check(
      (await scalar('select last_error from webhook_deliveries where id=$1', [
        success.id,
      ])) === null,
      'success clears stale error',
    )
    const trace = await scalar('select delivery_event_detail($1,$2)', [
      org,
      success.event_id,
    ])
    check(
      trace.attempts.length >= 1 && trace.event.protocol === 'secure-v2',
      'recorded lifecycle',
    )
    const all = (await db.query('select id from webhook_deliveries')).rows.map(
      (x) => x.id,
    )
    await db.exec(
      "update webhook_deliveries set status='dead',lease_token=null,lease_until=null",
    )
    const preview = await scalar('select delivery_recovery($1,$2,$3,$4)', [
      org,
      all,
      'preview_retry',
      randomUUID(),
    ])
    check(preview.eligible === all.length, 'bulk preview')
    await assert.rejects(
      db.query('select delivery_recovery($1,$2,$3,$4,false)', [
        org,
        all,
        'retry',
        randomUUID(),
      ]),
      /CONFIRMATION/,
    )
    checks++
    await scalar('select delivery_recovery($1,$2,$3,$4,true)', [
      org,
      all,
      'retry',
      randomUUID(),
    ])
    check(
      (await scalar(
        'select count(*)::integer from webhook_deliveries where status=$1',
        ['pending'],
      )) === 3,
      'bulk requeue',
    )
    await db.exec(
      "update webhook_deliveries set retry_deadline=now()-interval '1 second'",
    )
    await claim()
    check(
      (await scalar(
        "select count(*)::integer from webhook_deliveries where status='dead' and terminal_reason='retry_age'",
      )) === 3,
      'bounded retry age',
    )
    await db.exec(
      "update telemetry set timestamp=now()-interval '2 days';update webhook_deliveries set created_at=now()-interval '2 days';",
    )
    await db.query('select purge_expired_telemetry()')
    check(
      (await scalar('select count(*)::integer from telemetry')) === 0,
      'sample retention',
    )
    check(
      (await scalar('select count(*)::integer from webhook_deliveries')) === 3,
      'delivery retained independently',
    )
    check(
      (await scalar('select count(*)::integer from telemetry_events')) === 3,
      'identity survives sample expiry',
    )
    await db.exec(
      "update webhook_deliveries set payload_expires_at=now()-interval '1 second'",
    )
    await db.query('select purge_expired_telemetry()')
    check(
      (await scalar(
        'select count(*)::integer from webhook_deliveries where body is null',
      )) === 3,
      'payload bounded',
    )
    await assert.rejects(
      db.query('select delivery_recovery($1,$2,$3,$4,true)', [
        org,
        [all[0]],
        'retry',
        randomUUID(),
      ]),
      /EXPIRED/,
    )
    checks++
    const other = randomUUID(),
      org2 = randomUUID()
    await db.query('insert into auth.users values($1,$2)', [
      other,
      'other@example.invalid',
    ])
    await db.query("insert into organizations(id,name) values($1,'Other')", [
      org2,
    ])
    await db.query(
      "insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')",
      [org2, other],
    )
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ])
    await db.exec('set role authenticated')
    check(
      (await scalar('select count(*)::integer from webhook_deliveries')) === 0,
      'tenant RLS',
    )
    check(
      (await scalar('select count(*)::integer from telemetry_events')) === 0,
      'event tenant RLS',
    )
    check(
      (await scalar('select count(*)::integer from webhook_attempts')) === 0,
      'attempt tenant RLS',
    )
    await assert.rejects(
      db.query('select delivery_event_detail($1,$2)', [org, first.eventIds[0]]),
      /authorized/,
    )
    checks++
    await assert.rejects(recovery(), /PERMISSION_DENIED/)
    checks++
    await assert.rejects(
      db.query('select * from claim_webhook_deliveries_v2(8)'),
      /permission denied/,
    )
    checks++
    await assert.rejects(
      db.query("update webhook_deliveries set status='pending'"),
      /permission denied/,
    )
    checks++
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ])
    await db.query(
      "update organizations set subscription_tier='scale' where id=$1",
      [org],
    )
    await db.query(
      "update organization_members set role='viewer' where organization_id=$1",
      [org],
    )
    await db.exec('set role authenticated')
    await assert.rejects(
      db.query('select delivery_recovery($1,$2,$3,$4,true)', [
        org,
        [all[0]],
        'retry',
        randomUUID(),
      ]),
      /PERMISSION_DENIED/,
    )
    checks++
    check(
      (await scalar('select delivery_search($1)', [org])).length === 3,
      'viewer can inspect safe data',
    )
    await db.exec('reset role')
    fs.writeFileSync(
      'docs/phase-3-4/evidence/database.json',
      JSON.stringify(
        {
          checks,
          passed: checks,
          database: 'PGlite PostgreSQL single backend',
          scenarios: [
            'Secure V2 authentication/commit/duplicates',
            'atomic outbox failure rollback',
            'batch identity',
            'lease recovery and stale fencing',
            '503 Retry-After',
            '401 dead letter',
            'manual idempotent/bulk recovery',
            'pause/resume',
            'retention',
            'multi-tenant RLS',
            'viewer permissions',
          ],
          multi_backend_concurrency: 'not tested in this fixture',
        },
        null,
        2,
      ),
    )
    console.log(`PASS ${checks} pipeline database/gateway checks`)
  } finally {
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
