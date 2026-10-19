const assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto'),
  { setup } = require('./fixture.cjs')
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
    const request = randomUUID(),
      r = await f.preview(f.definition, request)
    check((await f.preview(f.definition, request)) === r, 'preview idempotence')
    await reject(
      f.preview({ ...f.definition, maxConcurrent: 2 }, request),
      /IDEMPOTENCY/,
    )
    check(
      (await scalar('select management_tick()')).scheduled === 0,
      'draft creates no work',
    )
    await f.admin('confirm', { id: r, kind: 'firmware', confirm: true })
    check(
      (await scalar('select management_tick()')).scheduled === 1,
      'confirmed scheduler issues bounded assignment',
    )
    const polled = await f.deviceRequest('poll'),
      op = polled.operation
    check(
      op.manifest.sha256 === f.manifest.sha256,
      'actual signed artifact selected',
    )
    check(op.state === 'assigned', 'assignment is not installation')
    await reject(
      f.deviceRequest('report', {
        id: op.id,
        generation: op.generation,
        stage: 'healthy',
      }),
      /HEALTH_EVIDENCE/,
    )
    for (const stage of [
      'downloading',
      'verified',
      'installing',
      'awaiting_reboot',
      'booting',
    ])
      await f.deviceRequest('report', {
        id: op.id,
        generation: op.generation,
        stage,
      })
    await reject(
      f.deviceRequest('report', {
        id: op.id,
        generation: op.generation,
        stage: 'healthy',
        sha256: '00'.repeat(32),
        securityVersion: 1,
        healthValidated: true,
      }),
      /HEALTH_EVIDENCE/,
    )
    await f.deviceRequest('report', {
      id: op.id,
      generation: op.generation,
      stage: 'healthy',
      sha256: f.manifest.sha256,
      securityVersion: 1,
      healthValidated: true,
    })
    check(
      (await scalar('select state from firmware_rollouts where id=$1', [r])) ===
        'running',
      'health report does not skip scheduler gate',
    )
    await scalar('select management_tick()')
    check(
      (await scalar('select state from firmware_rollouts where id=$1', [r])) ===
        'completed',
      'wave completes from device health evidence',
    )
    check(
      (await scalar(
        'select security_version from device_management_profiles where device_id=$1',
        [f.device],
      )) === 1,
      'monotonic acknowledged security version',
    )
    const settings = {
        reportIntervalSeconds: 300,
        sampleIntervalSeconds: 60,
        diagnosticLevel: 'error',
      },
      config = await f.preview({
        kind: 'configuration',
        configuration: settings,
        selection: { ids: [f.device] },
        wavePercentages: [100],
        observationSeconds: 0,
        manualAdvance: false,
      })
    await f.admin('confirm', {
      id: config,
      kind: 'configuration',
      confirm: true,
    })
    await scalar('select management_tick()')
    check(
      (await scalar(
        'select reported_config from device_management_profiles where device_id=$1',
        [f.device],
      )) === null,
      'desired is separate from reported',
    )
    const cfg = (await f.deviceRequest('poll')).operation
    await reject(
      f.deviceRequest('report', {
        id: cfg.id,
        generation: cfg.generation,
        stage: 'applied',
      }),
      /CONFIGURATION_REPORT/,
    )
    await f.deviceRequest('report', {
      id: cfg.id,
      generation: cfg.generation,
      stage: 'applied',
      configuration: settings,
    })
    check(
      (
        await scalar(
          'select reported_config from device_management_profiles where device_id=$1',
          [f.device],
        )
      ).reportIntervalSeconds === 300,
      'only correct authenticated configuration acknowledgment applies state',
    )
    await reject(
      f.deviceRequest('report', {
        id: op.id,
        generation: op.generation,
        stage: 'failed',
      }),
      /TERMINAL/,
    )
    await reject(
      f.preview({
        kind: 'configuration',
        configuration: { ...settings, password: 'no' },
        selection: { ids: [f.device] },
        wavePercentages: [100],
      }),
      /INVALID_CONFIGURATION/,
    )
    await reject(
      f.preview({ ...f.definition, selection: { ids: [randomUUID()] } }),
      /FOREIGN_DEVICE/,
    )
    await reject(
      db.query('update firmware_artifacts set sha256=$1 where id=$2', [
        '00'.repeat(32),
        f.manifest.artifactId,
      ]),
      /IMMUTABLE/,
    )
    const viewer = randomUUID()
    await db.query(
      "insert into auth.users values($1,'viewer@management.invalid')",
      [viewer],
    )
    await db.query(
      "insert into organization_members(organization_id,user_id,role) values($1,$2,'viewer')",
      [f.org, viewer],
    )
    await reject(
      f.admin('approve', { id: f.manifest.artifactId }, viewer),
      /PERMISSION_DENIED/,
    )
    await reject(
      f.preview(f.definition, randomUUID(), viewer),
      /PERMISSION_DENIED/,
    )
    await db.exec('set role authenticated')
    await reject(scalar('select management_tick()'), /permission denied/)
    await reject(
      db.query('select * from management_challenges'),
      /permission denied/,
    )
    await reject(
      db.query('select * from firmware_download_tokens'),
      /permission denied/,
    )
    await db.exec('reset role')
    check(
      (await scalar(
        "select count(*)::int from audit_logs where event_action like 'management.%'",
      )) >= 6,
      'administrative actions audited',
    )
    await db.query("update devices set lifecycle='revoked' where id=$1", [
      f.device,
    ])
    await reject(f.deviceRequest('poll'), /MANAGEMENT_UNAVAILABLE/)
    console.log(
      'PASS ' + n + ' management lifecycle/configuration/RLS/tenant checks',
    )
  } finally {
    await db.exec('reset role')
    await db.close()
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
