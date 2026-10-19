const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { fixture } = require('../pipelines/fixture.cjs')
const { credentials, tick } = require('../../tcp-server/fleet/worker')
const { decryptSecret } = require('../../tcp-server/auth')
const wire = require('../../sdk/js/secure-v2.cjs')
async function run() {
  const f = await fixture(),
    { db, scalar } = f
  let passed = 0
  const check = (v, m) => {
    assert(v, m)
    passed++
  }
  const rejects = async (p, re) => {
    await assert.rejects(p, re)
    passed++
  }
  const preview = (
    operation,
    rows = [],
    options = {},
    actor = f.user,
    filter = null,
    request = randomUUID(),
  ) =>
    scalar('select fleet_preview($1,$2,$3,$4,$5,$6,$7)', [
      f.org,
      actor,
      request,
      operation,
      JSON.stringify(options),
      JSON.stringify(rows),
      filter && JSON.stringify(filter),
    ])
  const action = (id, op = 'confirm') =>
    scalar('select fleet_job_action($1,$2,$3,$4)', [f.org, f.user, id, op])
  const adapter = {
    async rpc(name, args = {}) {
      try {
        const v = Object.values(args)
        return {
          data: await scalar(
            `select ${name}(${v.map((_, i) => '$' + (i + 1)).join(',')})`,
            v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : x)),
          ),
        }
      } catch (e) {
        return { error: { message: e.message } }
      }
    },
  }
  const execute = async (id) => {
    await action(id)
    while (await tick(adapter)) {}
    return scalar('select fleet_job_counts($1,$2)', [f.org, id])
  }
  try {
    await rejects(preview('create', [{ name: 'Unit' }]), /DISABLED/)
    await db.exec('update fleet_settings set enabled=true')
    const group = await scalar('select fleet_group($1,$2,null,$3,0,false)', [
      f.org,
      f.user,
      'Factory A',
    ])
    await rejects(
      preview('create', [{ name: 'Bad' }], {}, randomUUID()),
      /FORBIDDEN/,
    )
    await rejects(
      preview(
        'create',
        Array.from({ length: 5 }, () => ({ name: 'Unit' })),
      ),
      /FREE_DEVICE_LIMIT/,
    )
    const id = await preview(
      'create',
      [
        { name: 'Sensor α', external_id: 'unit-a', serial_number: 'SN1' },
        { name: 'Sensor β', external_id: 'unit-b' },
      ],
      {
        groups: [group],
        labels: ['outdoor'],
        sourceDevice: f.device,
        sourceSlot: 0,
      },
    )
    check(
      (await scalar('select count(*)::int from devices')) === 1,
      'preview creates no devices',
    )
    const counts = await execute(id)
    check(
      counts.created === 2,
      `two real secure devices: ${JSON.stringify(counts)}`,
    )
    const items = (
      await db.query(
        'select * from fleet_job_items where job_id=$1 order by item_index',
        [id],
      )
    ).rows
    const device = items[0].device_id
    check(
      await scalar('select secure_v2_enabled from devices where id=$1', [
        device,
      ]),
      'secure enrollment',
    )
    check(
      (await scalar(
        'select count(*)::int from secure_v2_schema_slots where device_id=$1',
        [device],
      )) === 1,
      'immutable schema copied',
    )
    check(
      (await scalar(
        'select count(*)::int from device_group_members where group_id=$1',
        [group],
      )) === 2,
      'group assigned',
    )
    const inv = await scalar('select fleet_inventory($1,$2,$3,0,50)', [
      f.org,
      f.user,
      JSON.stringify({ labels: ['outdoor'], group }),
    ])
    check(
      inv.total === 2 && inv.devices.every((d) => d.labels.includes('outdoor')),
      'inventory filtering',
    )
    check(
      !JSON.stringify(inv).includes('root_secret'),
      'inventory contains no credentials',
    )
    await action(id)
    check(
      (await scalar('select count(*)::int from devices')) === 3,
      'idempotent confirmation',
    )
    const request = randomUUID()
    const first = await preview('disable', [], {}, f.user, { group }, request)
    check(
      (await preview('disable', [], {}, f.user, { group }, request)) === first,
      'idempotent preview',
    )
    const before = await scalar(
      'select wire_device_id from devices where id=$1',
      [device],
    )
    const manifest = await scalar('select fleet_manifest($1,$2,$3,$4)', [
      f.org,
      f.user,
      id,
      [device],
    ])
    check(
      decryptSecret(manifest[0].root_secret_encrypted).length === 64,
      'explicit export can decrypt',
    )
    await rejects(
      scalar('select fleet_manifest($1,$2,$3,$4)', [
        f.org,
        f.user,
        id,
        [device],
      ]),
      /ALREADY_EXPORTED/,
    )
    await rejects(
      scalar('select fleet_manifest($1,$2,$3,$4)', [
        f.org,
        randomUUID(),
        id,
        [items[1].device_id],
      ]),
      /FORBIDDEN/,
    )
    check((await execute(first)).updated === 2, 'filtered disable snapshot')
    await rejects(
      scalar('select ingest_secure_v2_telemetry($1,0,$2,0,$3)', [
        before,
        Buffer.alloc(32, 1),
        '[{"value":42}]',
      ]),
      /NOT_ENABLED/,
    )
    await rejects(
      scalar('select bootstrap_secure_v2_counter($1,$2)', [
        before,
        Buffer.alloc(32, 1),
      ]),
      /NOT_ENABLED/,
    )
    const version = () =>
      scalar('select admin_version from devices where id=$1', [device])
    const enable = await preview('enable', [
      { id: device, version: await version() },
    ])
    check((await execute(enable)).updated === 1, 'enable eligible disabled')
    const stored = await scalar(
      'select root_secret_encrypted from secure_v2_credentials where wire_device_id=$1',
      [before],
    )
    const root = decryptSecret(stored)
    const frame = wire.buildFrame({
      rootSecret: root,
      wireDeviceId: Number(before),
      sequence: 0,
      slot: 0,
      confirmed: true,
      payload: Buffer.from([42]),
    })
    const result = await require('../../tcp-server/ingest').processFrame(
      frame,
      { supabase: f.adapter, transport: 'udp' },
    )
    check(
      result.parsed.value === 42 && result.receipt,
      'new credentials authenticate through real gateway',
    )
    const stale = await preview('disable', [
      { id: device, version: await version() },
    ])
    await db.query(
      "update devices set description='concurrent change' where id=$1",
      [device],
    )
    check((await execute(stale)).failed === 1, 'stale snapshot rejected')
    const rotate = await preview('reprovision', [
      { id: device, version: await version() },
    ])
    check((await execute(rotate)).updated === 1, 'manual reprovision')
    check(
      (await scalar('select wire_device_id from devices where id=$1', [
        device,
      ])) !== before,
      'new credential epoch wire ID',
    )
    await rejects(
      require('../../tcp-server/ingest').processFrame(frame, {
        supabase: f.adapter,
        transport: 'udp',
      }),
      /authentication failed/,
    )
    const revoke = await preview('revoke', [
      { id: device, version: await version() },
    ])
    check((await execute(revoke)).updated === 1, 'revoke')
    const badEnable = await preview('enable', [
      { id: device, version: await version() },
    ])
    check(
      (await execute(badEnable)).failed === 1,
      'revocation cannot be undone by enable',
    )
    await rejects(
      db.query('select enroll_device_secure_v2($1,$2,$3,$4,$5,$6,true,0)', [
        device,
        f.org,
        stored,
        'abcd',
        stored,
        Buffer.alloc(32, 1),
      ]),
      /REVOKED/,
    )
    const duplicate = await preview(
      'create',
      [{ name: 'duplicate', external_id: 'unit-b' }],
      { duplicates: 'skip' },
    )
    check(
      (await execute(duplicate)).skipped === 1,
      'skip existing identity without rotating',
    )
    const cancel = await preview('create', [{ name: 'Canceled' }])
    await action(cancel)
    const claimed = await scalar('select fleet_claim()')
    await action(cancel, 'cancel')
    check(
      (await scalar('select fleet_finish($1,$2,$3,$4)', [
        cancel,
        claimed.item.item_index,
        claimed.item.lease_token,
        JSON.stringify(credentials()),
      ])) === 'stale',
      'cancel fences active claim',
    )
    const recover = await preview('create', [
      { name: 'Recover', external_id: 'recover' },
    ])
    await action(recover)
    const c1 = await scalar('select fleet_claim()')
    await db.query(
      "update fleet_job_items set lease_until=now()-interval '1 second' where job_id=$1",
      [recover],
    )
    const c2 = await scalar('select fleet_claim()')
    check(
      c1.item.lease_token !== c2.item.lease_token,
      'expired lease reclaimed',
    )
    check(
      (await scalar('select fleet_finish($1,$2,$3,$4)', [
        recover,
        0,
        c1.item.lease_token,
        JSON.stringify(credentials()),
      ])) === 'stale',
      'old worker fenced',
    )
    check(
      (await scalar('select fleet_finish($1,$2,$3,$4)', [
        recover,
        0,
        c2.item.lease_token,
        JSON.stringify(credentials()),
      ])) === 'created',
      'crash recovery creates once',
    )
    check(
      (await scalar('select fleet_finish($1,$2,$3,$4)', [
        recover,
        0,
        c2.item.lease_token,
        JSON.stringify(credentials()),
      ])) === 'stale',
      'lost response cannot duplicate creation',
    )
    check(
      await scalar('select integration_match($1,$2)', [
        JSON.stringify({ field: 'labels', op: 'contains', value: 'outdoor' }),
        JSON.stringify({ labels: ['outdoor'] }),
      ]),
      'existing routing exact label membership',
    )
    for (const role of ['anon', 'authenticated'])
      check(
        !(await scalar(
          "select has_function_privilege($1,'fleet_finish(uuid,integer,uuid,jsonb)','EXECUTE')",
          [role],
        )),
        'service-only execution',
      )
    check(
      (await scalar('select count(*)::int from fleet_audit')) > 10,
      'durable audit',
    )
    console.log(`fleet database/gateway: ${passed} assertions passed`)
  } finally {
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
