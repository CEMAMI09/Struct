const assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto'),
  fs = require('node:fs'),
  { fixture } = require('../pipelines/fixture.cjs'),
  core = require('../../tcp-server/integrations')
process.env.STRUCT_INTEGRATION_KEY = '56'.repeat(32)
;(async () => {
  const f = await fixture(),
    { db, scalar } = f
  let passed = 0
  const check = (v, message) => {
    assert(v, message)
    passed++
  }
  const rejects = async (fn, pattern) => {
    await assert.rejects(fn, pattern)
    passed++
  }
  try {
    await db.exec(
      'update delivery_pipeline_settings set enabled=true;update integration_settings set enabled=true',
    )
    const id = randomUUID(),
      config = { url: 'https://example.com/hook', headers: {} },
      mapping = core.validateMapping(null),
      cipher = core.seal({ signingSecret: 'test-only' }, f.org, id)
    const save = (version = 0, route = null, actor = f.user, conf = config) =>
      scalar('select save_integration($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
        f.org,
        actor,
        id,
        'Integration',
        'http',
        JSON.stringify(conf),
        route ? JSON.stringify(route) : null,
        JSON.stringify(mapping),
        version === 0 ? cipher : null,
        version,
        true,
      ])
    check((await save()) === 1, 'create version one')
    check(
      (await scalar('select enabled from destinations where id=$1', [id])) ===
        false,
      'new integration always disabled',
    )
    await f.ingest(0)
    check(
      (await scalar(
        'select count(*)::int from webhook_deliveries where destination_id=$1',
        [id],
      )) === 0,
      'disabled integration never routes',
    )
    const act = (action, version = 1, actor = f.user) =>
      scalar('select integration_action($1,$2,$3,$4,$5)', [
        f.org,
        actor,
        id,
        version,
        action,
      ])
    await act('enable')
    await f.ingest(1, [42, 43])
    check(
      (await scalar(
        'select count(*)::int from webhook_deliveries where destination_id=$1',
        [id],
      )) === 2,
      'per-reading fanout',
    )
    await f.ingest(1, [42, 43])
    check(
      (await scalar(
        'select count(*)::int from webhook_deliveries where destination_id=$1',
        [id],
      )) === 2,
      'retransmission does not duplicate work',
    )
    await rejects(
      () => save(1, { field: 'payload.value', op: 'gt', value: 40 }),
      /Scale/,
    )
    await db.query(
      "update organizations set subscription_tier='scale' where id=$1",
      [f.org],
    )
    check(
      (await save(1, {
        all: [
          { field: 'payload.value', op: 'gt', value: 40 },
          { field: 'device_id', op: 'eq', value: f.device },
        ],
      })) === 2,
      'versioned routing save',
    )
    await f.ingest(2, [10, 45])
    check(
      (await scalar(
        'select count(*)::int from webhook_deliveries where destination_id=$1',
        [id],
      )) === 3,
      'AND rule excludes nonmatching reading',
    )
    check(
      (await scalar(
        "select (integration_snapshot->>'version')::int from webhook_deliveries where destination_id=$1 order by created_at,id limit 1",
        [id],
      )) === 1,
      'old routing decision remains version one',
    )
    await save(2, null, f.user, { url: 'https://example.com/new', headers: {} })
    check(
      (await scalar(
        "select integration_snapshot->'config'->>'url' from webhook_deliveries where destination_id=$1 order by created_at,id limit 1",
        [id],
      )) === config.url,
      'queued target remains frozen',
    )
    await rejects(() => save(1), /CONFLICT/)
    const foreign = randomUUID()
    await db.query('insert into auth.users values($1,$2)', [
      foreign,
      'foreign@example.invalid',
    ])
    await rejects(() => save(3, null, foreign), /Not authorized/)
    await rejects(() => act('delete', 3, foreign), /Not authorized/)
    const match = async (rule, event) =>
      scalar('select integration_match($1,$2)', [
        JSON.stringify(rule),
        JSON.stringify(event),
      ])
    for (const [rule, event, result] of [
      [
        { field: 'payload.n', op: 'gt', value: '9007199254740992' },
        { payload: { n: '9007199254740993' } },
        true,
      ],
      [
        { field: 'payload.n', op: 'lt', value: '9007199254740992' },
        { payload: { n: '9007199254740993' } },
        false,
      ],
      [
        {
          any: [
            { field: 'payload.active', op: 'eq', value: true },
            { field: 'payload.state', op: 'contains', value: 'alarm' },
          ],
        },
        { payload: { state: 'alarm-high' } },
        true,
      ],
      [{ field: 'payload.no', op: 'exists' }, { payload: {} }, false],
      [
        { field: 'payload.x', op: 'eq', value: 0 },
        { payload: { x: false } },
        false,
      ],
    ])
      check(
        (await match(rule, event)) === result,
        'decimal/existence/OR/type semantics',
      )
    await act('pause', 3)
    check(
      await scalar(
        'select paused_at is not null from destinations where id=$1',
        [id],
      ),
      'pause stored',
    )
    await f.ingest(3)
    check(
      (await scalar(
        'select count(*)::int from webhook_deliveries where destination_id=$1',
        [id],
      )) === 4,
      'paused destination retains new durable work',
    )
    await act('resume', 3)
    // Old worker must fail closed after activation.
    await rejects(
      () => db.query('select * from claim_webhook_deliveries_v2(8)'),
      /UPGRADE_INTEGRATION_WORKER/,
    )
    const claims = (
      await db.query('select * from claim_integration_deliveries(8)')
    ).rows
    check(
      claims.some((j) => j.destination_id === id),
      'adapter work claimed by shared scheduler',
    )
    const job = claims.find((j) => j.destination_id === id)
    check(
      await scalar(
        "select finish_webhook_delivery_v2($1,$2,'retry','provider unavailable',503,'http_transient',10)",
        [job.id, job.lease_token],
      ),
      'shared retry scheduling',
    )
    check(
      (await scalar('select status from webhook_deliveries where id=$1', [
        job.id,
      ])) === 'pending',
      'retry durable',
    )
    check(
      !(await scalar("select finish_webhook_delivery_v2($1,$2,'delivered')", [
        job.id,
        job.lease_token,
      ])),
      'stale completion fenced',
    )
    // Explicit mapping recovery is bounded to the previewed identities.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      f.user,
    ])
    await db.query(
      "update webhook_deliveries set status='dead',terminal_reason='mapping' where id=$1",
      [job.id],
    )
    const requestId = randomUUID()
    const remap = (confirm, request = requestId, version = 3) =>
      scalar('select integration_remap_failed($1,$2,$3,$4,$5)', [
        f.org,
        id,
        version,
        request,
        confirm,
      ])
    await rejects(() => remap(true), /PREVIEW_REQUIRED/)
    const beforeSnapshot = await scalar(
      'select integration_snapshot from webhook_deliveries where id=$1',
      [job.id],
    )
    check(
      (await remap(false)).eligible === 1,
      'recovery preview reports eligible work',
    )
    check(
      (await scalar('select status from webhook_deliveries where id=$1', [
        job.id,
      ])) === 'dead',
      'preview does not dispatch',
    )
    // Another failure appearing after preview must not expand the approved bulk operation.
    const other = await scalar(
      'select id from webhook_deliveries where destination_id=$1 and id<>$2 order by created_at,id limit 1',
      [id, job.id],
    )
    await db.query("update webhook_deliveries set status='dead' where id=$1", [
      other,
    ])
    check(
      (await remap(true)).scheduled === 1,
      'confirmation does not include newly failed work',
    )
    check(
      (await remap(true)).duplicate_request === true,
      'recovery request idempotent',
    )
    check(
      (await scalar('select replay_count from webhook_deliveries where id=$1', [
        job.id,
      ])) === 1,
      'recovery cycle increments once',
    )
    const afterSnapshot = await scalar(
      'select integration_snapshot from webhook_deliveries where id=$1',
      [job.id],
    )
    check(
      JSON.stringify(afterSnapshot.config) ===
        JSON.stringify(beforeSnapshot.config) &&
        afterSnapshot.mapping_version === 3,
      'recovery preserves original target and records reviewed mapping version',
    )
    await db.query(
      "update webhook_deliveries set status='dead',payload_expires_at=now()-interval '1 second' where id=$1",
      [other],
    )
    check(
      (await remap(false, randomUUID())).eligible === 0,
      'expired payload excluded from mapping recovery',
    )
    await rejects(() => remap(false, randomUUID(), 2), /CONFLICT/)
    // Provider acceptance IDs share the fenced completion transaction.
    await db.query(
      'update webhook_destination_runtime set next_dispatch_at=now() where destination_id=$1',
      [id],
    )
    const receiptJob = (
      await db.query('select * from claim_integration_deliveries(8)')
    ).rows.find((j) => j.destination_id === id)
    check(!!receiptJob, 'recovered job claimable')
    check(
      await scalar(
        "select finish_integration_delivery($1,$2,'delivered','accepted',200,null,1,null,'provider_123')",
        [receiptJob.id, receiptJob.lease_token],
      ),
      'provider completion accepted',
    )
    check(
      (await scalar(
        'select provider_receipt from webhook_attempts where delivery_id=$1 and lease_token=$2',
        [receiptJob.id, receiptJob.lease_token],
      )) === 'provider_123',
      'provider receipt stored with actual attempt',
    )
    await db.exec('set role authenticated')
    await rejects(
      () => db.query('update destinations set enabled=false where id=$1', [id]),
      /Managed integration/,
    )
    await rejects(
      () => db.query('delete from destinations where id=$1', [id]),
      /Managed integration/,
    )
    await rejects(
      () =>
        db.query('select credentials_encrypted from integration_definitions'),
      /permission denied/,
    )
    await rejects(
      () =>
        db.query(
          'select * from save_integration($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [f.org, f.user, id, 'bad', 'http', '{}', null, '{}', cipher, 3, true],
        ),
      /permission denied/,
    )
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      foreign,
    ])
    await rejects(
      () =>
        db.query('select delivery_event_detail($1,$2)', [f.org, job.event_id]),
      /Not authorized/,
    )
    await rejects(() => remap(false, randomUUID()), /Not authorized/)
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      f.user,
    ])
    await act('delete', 3)
    check(
      await scalar(
        'select deleted_at is not null from integration_definitions where destination_id=$1',
        [id],
      ),
      'soft deletion retains history',
    )
    check(
      (await scalar(
        'select credentials_encrypted from integration_definitions where destination_id=$1',
        [id],
      )) === 'deleted',
      'delete erases credentials',
    )
    check(
      (await scalar(
        'select count(*)::int from webhook_deliveries where destination_id=$1',
        [id],
      )) === 4,
      'delete retains delivery history',
    )
    check(
      (await scalar(
        'select count(*)::int from integration_audit where destination_id=$1',
        [id],
      )) >= 7,
      'actions audited without secrets',
    )
    fs.mkdirSync('docs/phase-7/evidence', { recursive: true })
    fs.writeFileSync(
      'docs/phase-7/evidence/database.json',
      JSON.stringify(
        {
          passed,
          timestamp: new Date().toISOString(),
          database: 'PGlite actual migration and Secure V2 gateway ingestion',
        },
        null,
        2,
      ),
    )
    console.log(
      `PASS ${passed} integration database, routing, retry and tenant checks`,
    )
  } finally {
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
