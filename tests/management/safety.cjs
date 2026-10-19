const assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  { setup } = require('./fixture.cjs'),
  core = require('../../protocol/management/core.cjs')
async function run() {
  const f = await setup(),
    { db, scalar } = f
  let n = 0
  const check = (v, m) => {
      assert(v, m)
      n++
    },
    reject = async (p, re) => {
      await assert.rejects(p, re)
      n++
    }
  try {
    const id = crypto.randomUUID(),
      nonce = crypto.randomBytes(32),
      hash = 'ab'.repeat(32)
    await scalar('select management_challenge($1,$2,$3,$4)', [
      f.wireId,
      id,
      core.digest(nonce),
      hash,
    ])
    await db.query(
      "update management_challenges set expires_at=now()-interval '1 second' where id=$1",
      [id],
    )
    await reject(
      scalar("select management_device($1,$2,$3,$4,'poll','{}')", [
        f.wireId,
        id,
        core.digest(nonce),
        hash,
      ]),
      /EXPIRED/,
    )
    await f.admin('enable_device', { id: f.device, enabled: false })
    check(
      (await f.preview(f.definition)) !== null,
      'ineligible preview remains inspectable',
    )
    const disabled = await f.preview(f.definition)
    await reject(
      f.admin('confirm', { id: disabled, kind: 'firmware', confirm: true }),
      /CONFIRMATION/,
    )
    await f.admin('enable_device', { id: f.device, enabled: true })

    await f.deviceRequest('capabilities', f.capabilities)
    check(
      (await scalar(
        'select enabled from device_management_profiles where device_id=$1',
        [f.device],
      )) === true,
      'Identical capabilities preserve approval',
    )
    await f.deviceRequest('capabilities', {
      ...f.capabilities,
      hardwareRevision: 'B',
    })
    check(
      (await scalar(
        'select enabled from device_management_profiles where device_id=$1',
        [f.device],
      )) === false,
      'Changed hardware invalidates prior approval',
    )
    await f.deviceRequest('capabilities', f.capabilities)
    await f.admin('enable_device', { id: f.device, enabled: true })
    const group = await scalar(
      "insert into device_groups(organization_id,name) values($1,'Canary fixture') returning id",
      [f.org],
    )
    await db.query(
      'insert into device_group_members(organization_id,group_id,device_id) values($1,$2,$3)',
      [f.org, group, f.device],
    )
    const grouped = await f.preview({ ...f.definition, selection: { group } })
    await db.query('delete from device_group_members where group_id=$1', [
      group,
    ])
    check(
      (await scalar(
        'select count(*)::int from rollout_targets where rollout_id=$1',
        [grouped],
      )) === 1,
      'Group targets snapshotted before membership changes',
    )
    const empty = await f.preview({ ...f.definition, selection: { group } })
    check(
      (await scalar(
        'select count(*)::int from rollout_targets where rollout_id=$1',
        [empty],
      )) === 0,
      'Future preview uses new membership',
    )
    await f.admin('cancel', { id: grouped })
    await f.admin('cancel', { id: empty })
    const manual = await f.preview({
      ...f.definition,
      wavePercentages: [1, 10, 100],
      manualAdvance: true,
      observationSeconds: 60,
    })
    await f.admin('confirm', { id: manual, kind: 'firmware', confirm: true })
    await scalar('select management_tick()')
    const op = (await f.deviceRequest('poll')).operation

    check(
      Number.isInteger(op.remainingSeconds) &&
        op.remainingSeconds > 0 &&
        op.remainingSeconds <= 3600,
      'Authenticated assignment includes bounded remaining execution time',
    )
    await db.query(
      "update firmware_rollouts set ends_at=now()-interval '1 second' where id=$1",
      [manual],
    )
    check(
      (await f.deviceRequest('poll')).operation === null,
      'No new assignment after execution window closes',
    )
    const authorization = await scalar(
      'select to_jsonb(t) from firmware_download_tokens t where operation_id=$1 limit 1',
      [op.id],
    )
    await reject(
      scalar('select management_download($1,$2,$3)', [
        authorization.id,
        authorization.token_hash,
        op.id,
      ]),
      /WINDOW_CLOSED/,
    )
    await db.query(
      "update firmware_rollouts set ends_at=now()+interval '7 days' where id=$1",
      [manual],
    )
    await reject(f.admin('advance', { id: manual }), /EVIDENCE/)
    await f.admin('pause', { id: manual })
    check(
      (await scalar('select management_tick()')).scheduled === 0,
      'pause stops new scheduling',
    )
    await f.admin('cancel', { id: manual })
    check(
      (await scalar('select state from device_operations where id=$1', [
        op.id,
      ])) === 'assigned',
      'cancel never claims a physical abort',
    )
    await db.query(
      "update device_operations set created_at=now()-interval '2 hours' where id=$1",
      [op.id],
    )
    await scalar('select management_tick()')
    check(
      (await scalar('select state from device_operations where id=$1', [
        op.id,
      ])) === 'unknown',
      'Canceled rollout assignments still expire without new packets',
    )
    await f.deviceRequest('report', {
      id: op.id,
      generation: op.generation,
      stage: 'rejected',
      category: 'test_rejection',
    })
    await db.query(
      "update firmware_rollouts set updated_at=now()-interval '91 days' where id=$1",
      [manual],
    )
    await scalar('select management_cleanup()')
    check(
      (await scalar('select count(*)::int from firmware_rollouts where id=$1', [
        manual,
      ])) === 0,
      'Only expired terminal rollout evidence cleaned',
    )
    check(
      (await scalar(
        'select count(*)::int from firmware_artifacts where id=$1',
        [f.manifest.artifactId],
      )) === 1,
      'History cleanup preserves immutable artifact and device state',
    )
    const timed = await f.preview({ ...f.definition, timeoutSeconds: 60 })
    await f.admin('confirm', { id: timed, kind: 'firmware', confirm: true })
    await scalar('select management_tick()')
    await db.query(
      "update device_operations set created_at=now()-interval '61 seconds' where rollout_id=$1",
      [timed],
    )
    await scalar('select management_tick()')
    check(
      (await scalar('select state from device_operations where rollout_id=$1', [
        timed,
      ])) === 'unknown',
      'timeout is not fabricated failure',
    )
    check(
      (await scalar('select reason from firmware_rollouts where id=$1', [
        timed,
      ])) === 'failure_or_unknown_threshold',
      'unknown pauses rollout',
    )
    await db.exec('update observability_settings set enabled=true')
    const rule = crypto.randomUUID()
    await scalar('select observability_command($1,$2,$3,$4)', [
      f.org,
      f.user,
      'rule',
      JSON.stringify({
        id: rule,
        name: 'Rollout safety',
        kind: 'rollout_failures',
        device: f.device,
        threshold: 1,
        clear: 0,
        window: 60,
        hold: 0,
        cooldown: 300,
        enabled: true,
      }),
    ])
    await scalar('select evaluate_alert_rule($1)', [rule])
    await scalar('select evaluate_alert_rule($1)', [rule])
    check(
      (await scalar(
        'select count(*)::int from alert_incidents where rule_id=$1',
        [rule],
      )) === 1,
      'existing alert lifecycle deduplicates safety pauses',
    )
    const token = crypto.randomUUID(),
      secret = crypto.randomBytes(32),
      tid = await scalar(
        'select id from device_operations where rollout_id=$1',
        [timed],
      )
    await db.query(
      'insert into firmware_download_tokens(id,operation_id,wire_device_id,token_hash) values($1,$2,$3,$4)',
      [token, tid, f.wireId, core.digest(secret)],
    )
    await reject(
      scalar('select management_download($1,$2,$3)', [
        token,
        core.digest(secret),
        tid,
      ]),
      /DOWNLOAD/,
    )
    const next = await f.preview(f.definition)
    await f.admin('confirm', { id: next, kind: 'firmware', confirm: true })
    await scalar('select management_tick()')
    const assigned = (await f.deviceRequest('poll')).operation
    await f.admin('revoke_key', { id: f.keyId })
    await reject(f.deviceRequest('poll'), /ARTIFACT/)
    await f.deviceRequest('report', {
      id: assigned.id,
      generation: assigned.generation,
      stage: 'rejected',
      category: 'key_revoked',
    })
    await reject(
      f.preview({ ...f.definition, wavePercentages: [25, 10, 100] }),
      /WAVES/,
    )
    await reject(
      f.preview({ ...f.definition, selection: { group: crypto.randomUUID() } }),
      /FOREIGN_GROUP/,
    )
    check(
      (
        await scalar('select management_rollout($1,$2,$3,0)', [
          f.org,
          f.user,
          next,
        ])
      ).targets.length === 1,
      'paginated target evidence available',
    )
    await reject(
      scalar('select management_rollout($1,$2,$3,0)', [
        f.org,
        f.user,
        crypto.randomUUID(),
      ]),
      /FOREIGN/,
    )
    const altered = await scalar(
      'select to_jsonb(c) from secure_v2_credentials c where wire_device_id=$1',
      [f.wireId],
    )
    await db.query('update devices set wire_device_id=$1 where id=$2', [
      f.wireId + 500,
      f.device,
    ])
    await reject(f.deviceRequest('poll'), /UNAVAILABLE/)
    check(
      altered.revoked_at === null,
      'old telemetry credential may remain unrevoked while management rejects old epoch',
    )
    await db.query(
      "update management_challenges set expires_at=now()-interval '2 hours'",
    )
    await scalar('select management_cleanup()')
    check(
      (await scalar('select count(*)::int from management_challenges')) === 0,
      'expired secrets cleaned in bounded batches',
    )
    console.log(
      'PASS ' +
        n +
        ' management timeout/cancel/epoch/revocation/alert/retention safety checks',
    )
  } finally {
    await db.close()
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
