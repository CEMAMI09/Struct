const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const { fixture } = require('./fixture.cjs')
const { deliver } = require('../../tcp-server/outbox')
let checks = 0
const check = (value, message) => {
  assert(value, message)
  checks++
}
;(async () => {
  const { db, scalar, ingest, org, destination, user, adapter } =
    await fixture()
  try {
    await db.exec('update delivery_pipeline_settings set enabled=true')
    await assert.rejects(
      db.query('select * from claim_webhook_deliveries(1)'),
      /UPGRADE_DELIVERY_WORKER/,
    )
    checks++
    await ingest(
      0,
      Array.from({ length: 110 }, (_, i) => i),
    )
    await db.exec("update webhook_deliveries set status='dead'")
    const selection = await scalar('select delivery_recovery_selection($1)', [
      org,
    ])
    check(
      selection.ids.length === 100 && selection.eligible_total === 110,
      'bounded selection preserves total',
    )
    check(
      (
        await scalar('select delivery_recovery_selection($1,$2)', [
          org,
          randomUUID(),
        ])
      ).eligible_total === 0,
      'destination filter',
    )
    await db.query('select pause_webhook_destination($1,true,$2)', [
      destination,
      randomUUID(),
    ])
    check(
      (await scalar('select delivery_recovery_selection($1)', [org]))
        .eligible_total === 0,
      'paused not eligible',
    )
    await db.query('select pause_webhook_destination($1,false,$2)', [
      destination,
      randomUUID(),
    ])
    await assert.rejects(
      db.query(
        "select delivery_recovery_selection($1,null,null,null,null,now(),now()-interval '1 day')",
        [org],
      ),
      /time range/,
    )
    checks++
    await scalar('select delivery_recovery($1,$2,$3,$4,true)', [
      org,
      selection.ids,
      'retry',
      randomUUID(),
    ])
    check(
      (await scalar('select delivery_recovery_selection($1)', [org]))
        .eligible_total === 10,
      'selection excludes newly queued work',
    )
    const id = selection.ids[0]
    await db.query(
      "update webhook_deliveries set status='dead',attempts=7 where id=$1",
      [id],
    )
    await db.query(
      "update webhook_deliveries set next_attempt_at=now()+interval '1 hour' where id<>$1",
      [id],
    )
    await scalar('select delivery_recovery($1,$2,$3,$4,true)', [
      org,
      [id],
      'retry',
      randomUUID(),
    ])
    await db.query('update webhook_deliveries set attempts=7 where id=$1', [id])
    const job = (await db.query('select * from claim_webhook_deliveries_v2(1)'))
      .rows[0]
    check(job.id === id && job.attempts === 8, 'eighth attempt claim')
    await scalar('select finish_webhook_delivery_v2($1,$2,$3)', [
      id,
      job.lease_token,
      'retry',
    ])
    check(
      (await scalar(
        'select terminal_reason from webhook_deliveries where id=$1',
        [id],
      )) === 'attempt_limit',
      'retry exhaustion terminal',
    )
    await scalar('select delivery_recovery($1,$2,$3,$4,true)', [
      org,
      [id],
      'retry',
      randomUUID(),
    ])
    await scalar('select delivery_recovery($1,$2,$3,$4,true)', [
      org,
      [id],
      'cancel',
      randomUUID(),
    ])
    check(
      (await scalar(
        'select terminal_reason from webhook_deliveries where id=$1',
        [id],
      )) === 'manual_cancel',
      'cancel explicit terminal reason',
    )
    await assert.rejects(
      db.query('select delivery_recovery($1,$2,$3,$4,true)', [
        org,
        [id],
        'retry',
        randomUUID(),
      ]),
      /REPLAY_LIMIT/,
    )
    checks++
    check(
      (await scalar('select delivery_pipeline_health()'))
        .unknown_last_minute === 0,
      'health contains recorded aggregate',
    )
    const invalidId = selection.ids[1]
    await db.query(
      'update webhook_deliveries set next_attempt_at=now() where id=$1',
      [invalidId],
    )
    await db.exec(
      'update webhook_destination_runtime set next_dispatch_at=now()',
    )
    const invalidJob = (
      await db.query('select * from claim_webhook_deliveries_v2(1)')
    ).rows[0]
    await deliver(adapter, invalidJob, async () => ({ status: 999 }), {
      pipelineV2: true,
    })
    check(
      (await scalar('select status from webhook_deliveries where id=$1', [
        invalidId,
      ])) === 'dead',
      'malformed HTTP status is terminal',
    )
    check(
      (await scalar('select http_status from webhook_deliveries where id=$1', [
        invalidId,
      ])) === null,
      'invalid HTTP status not persisted as valid evidence',
    )
    // A null/forged device claim cannot acquire another workspace identity.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      randomUUID(),
    ])
    await assert.rejects(
      db.query('select delivery_recovery_selection($1)', [org]),
      /authorized/,
    )
    checks++
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ])
    await db.exec(
      "delete from delivery_actions;update organizations set subscription_tier='scale';update organization_members set role='viewer';set role authenticated",
    )
    await assert.rejects(
      db.query('select delivery_recovery_selection($1)', [org]),
      /authorized/,
    )
    checks++
    await assert.rejects(
      db.query('select delivery_pipeline_health()'),
      /permission denied/,
    )
    checks++
    await assert.rejects(db.query('select lease_token from webhook_attempts'), /permission denied/)
    checks++
    await db.exec("reset role;update organization_members set role='owner'")
    for (let i = 0; i < 20; i++)
      await db.query('select pause_webhook_destination($1,$2,$3)', [
        destination,
        i % 2 === 0,
        randomUUID(),
      ])
    await assert.rejects(
      db.query('select pause_webhook_destination($1,true,$2)', [
        destination,
        randomUUID(),
      ]),
      /RATE_LIMIT/,
    )
    checks++
    fs.writeFileSync(
      'docs/phase-3-4/evidence/recovery-safety.json',
      JSON.stringify(
        {
          checks,
          passed: checks,
          selection: { eligible: 110, bounded: 100 },
          scenarios: [
            'legacy activation guard',
            'bounded filtered selection',
            'paused exclusion',
            'eight attempt ceiling',
            'three recovery cycles',
            'cancel audit',
            'rate limit',
            'tenant/viewer/operator permissions',
          ],
        },
        null,
        2,
      ),
    )
    console.log(`PASS ${checks} recovery safety checks`)
  } finally {
    await db.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
