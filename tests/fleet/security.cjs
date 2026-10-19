const assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto'),
  { fixture } = require('../pipelines/fixture.cjs'),
  { credentials, tick } = require('../../tcp-server/fleet/worker'),
  { decryptSecret } = require('../../tcp-server/auth'),
  wire = require('../../sdk/js/secure-v2.cjs'),
  core = require('../../tcp-server/integrations')
process.env.STRUCT_INTEGRATION_KEY = '56'.repeat(32)
async function run() {
  const f = await fixture(),
    { db, scalar } = f
  let checks = 0
  const check = (v, m) => {
    assert(v, m)
    checks++
  }
  const reject = async (p, re) => {
    await assert.rejects(p, re)
    checks++
  }
  const adapter = {
    async rpc(name, args = {}) {
      try {
        const a = Object.values(args).map((v) =>
          v && typeof v === 'object' ? JSON.stringify(v) : v,
        )
        return {
          data: await scalar(
            `select ${name}(${a.map((_, i) => '$' + (i + 1)).join(',')})`,
            a,
          ),
        }
      } catch (e) {
        return { error: { message: e.message } }
      }
    },
  }
  const preview = (
    op,
    opts = {},
    rows = [{ id: f.device, version: 1 }],
    actor = f.user,
  ) =>
    scalar('select fleet_preview($1,$2,$3,$4,$5,$6,null)', [
      f.org,
      actor,
      randomUUID(),
      op,
      JSON.stringify(opts),
      JSON.stringify(rows),
    ])
  const execute = async (job) => {
    await scalar("select fleet_job_action($1,$2,$3,'confirm')", [
      f.org,
      f.user,
      job,
    ])
    while (await tick(adapter)) {}
    return scalar('select fleet_job_counts($1,$2)', [f.org, job])
  }
  try {
    await db.exec(
      'update fleet_settings set enabled=true;update delivery_pipeline_settings set enabled=true;update integration_settings set enabled=true',
    )
    await db.query(
      "update organizations set subscription_tier='scale',stripe_quantity=100 where id=$1",
      [f.org],
    )
    const other = await fixture(db),
      g2 = await scalar('select fleet_group($1,$2,null,$3,0,false)', [
        other.org,
        other.user,
        'Foreign',
      ])
    await reject(
      preview('create', { groups: [g2] }, [{ name: 'bad' }]),
      /INVALID_GROUP/,
    )
    await reject(
      preview('create', { sourceDevice: other.device, sourceSlot: 0 }, [
        { name: 'bad' },
      ]),
      /SOURCE_SCHEMA/,
    )
    await reject(
      preview('disable', {}, [{ id: other.device, version: 1 }]),
      /FORBIDDEN/,
    )
    await reject(
      scalar('select fleet_inventory($1,$2,$3,0,50)', [
        f.org,
        other.user,
        '{}',
      ]),
      /FORBIDDEN/,
    )
    await reject(
      scalar('select fleet_inventory($1,$2,$3,0,50)', [
        f.org,
        f.user,
        JSON.stringify({ schemaDevice: other.device, schemaSlot: 0 }),
      ]),
      /FORBIDDEN/,
    )
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      f.user,
    ])
    await db.exec('set role authenticated')
    check(
      (await scalar('select count(*)::int from device_groups')) === 0,
      'group RLS excludes foreign group',
    )
    await reject(
      db.query("update devices set lifecycle='disabled' where id=$1", [
        f.device,
      ]),
      /permission denied/,
    )
    await reject(
      db.query('select root_secret_encrypted from secure_v2_credentials'),
      /permission denied/,
    )
    await reject(
      db.query("select fleet_preview($1,$2,$3,'create','{}','[]',null)", [
        f.org,
        f.user,
        randomUUID(),
      ]),
      /permission denied/,
    )
    await db.exec('reset role')
    const group = await scalar('select fleet_group($1,$2,null,$3,0,false)', [
      f.org,
      f.user,
      'Factory',
    ])
    await reject(
      db.query('insert into device_group_members values($1,$2,$3)', [
        f.org,
        g2,
        f.device,
      ]),
      /foreign key/,
    )
    const version = () =>
      scalar('select admin_version from devices where id=$1', [f.device])
    const membership = await preview('groups_add', { groups: [group] }, [
      { id: f.device, version: await version() },
    ])
    check((await execute(membership)).updated === 1, 'membership job')
    const label = await preview('labels_add', { labels: ['outdoor'] }, [
      { id: f.device, version: await version() },
    ])
    check((await execute(label)).updated === 1, 'label job')
    const dest = randomUUID(),
      route = {
        all: [
          { field: 'group_ids', op: 'contains', value: group },
          { field: 'labels', op: 'contains', value: 'outdoor' },
        ],
      }
    core.validateRoute(route)
    await scalar(
      'select save_integration($1,$2,$3,$4,$5,$6,$7,$8,$9,0,false)',
      [
        f.org,
        f.user,
        dest,
        'Fleet routing',
        'http',
        JSON.stringify({ url: 'https://example.com/hook', headers: {} }),
        JSON.stringify(route),
        JSON.stringify(core.validateMapping(null)),
        core.seal({ signingSecret: 'test-only' }, f.org, dest),
      ],
    )
    await scalar("select integration_action($1,$2,$3,1,'enable')", [
      f.org,
      f.user,
      dest,
    ])
    await f.ingest(0)
    const delivery = await scalar(
      'select integration_snapshot from webhook_deliveries where destination_id=$1',
      [dest],
    )
    check(
      delivery.organization_snapshot.group_ids.includes(group) &&
        delivery.organization_snapshot.labels.includes('outdoor'),
      'actual atomic outbox snapshots organization membership',
    )
    const remove = await preview('groups_remove', { groups: [group] }, [
      { id: f.device, version: await version() },
    ])
    await execute(remove)
    await f.ingest(1)
    check(
      (await scalar(
        'select count(*)::int from webhook_deliveries where destination_id=$1',
        [dest],
      )) === 1,
      'future-only routing, no retroactive rewrite',
    )
    await scalar('select fleet_group($1,$2,$3,$4,1,true)', [
      f.org,
      f.user,
      group,
      'Factory',
    ])
    check(
      (await scalar('select count(*)::int from telemetry where device_id=$1', [
        f.device,
      ])) === 2,
      'group deletion preserves telemetry',
    )
    check(
      (
        await scalar(
          'select integration_snapshot from webhook_deliveries where destination_id=$1',
          [dest],
        )
      ).organization_snapshot.group_ids.includes(group),
      'group deletion preserves queued evidence',
    )
    check(
      await scalar(
        'select credential_epoch_first_seen_at is not null from devices where id=$1',
        [f.device],
      ),
      'committed packet verifies current credentials',
    )
    const oldVersion = await version(),
      rotate = await preview('reprovision', {}, [
        { id: f.device, version: oldVersion },
      ])
    await execute(rotate)
    check(
      await scalar(
        'select credential_epoch_first_seen_at is null from devices where id=$1',
        [f.device],
      ),
      'rotation does not inherit physical provisioning evidence',
    )
    const row = (
      await db.query(
        'select * from secure_v2_credentials where device_id=$1 and revoked_at is null',
        [f.device],
      )
    ).rows[0]
    const frame = wire.buildFrame({
      rootSecret: decryptSecret(row.root_secret_encrypted),
      wireDeviceId: Number(row.wire_device_id),
      sequence: 0,
      slot: 0,
      confirmed: true,
      payload: Buffer.from([77]),
    })
    const result = await require('../../tcp-server/ingest').processFrame(
      frame,
      { supabase: f.adapter, transport: 'udp' },
    )
    check(
      result.parsed.value === 77 && result.receipt,
      'new key and counter epoch accepted through real gateway',
    )
    check(
      await scalar(
        'select credential_epoch_first_seen_at is not null from devices where id=$1',
        [f.device],
      ),
      'new-epoch telemetry verifies provisioning',
    )
    await reject(f.ingest(2), /authentication failed/)
    check(
      (await version()) > oldVersion,
      'credential epoch changes administrative version',
    )
    const disable = await preview('disable', {}, [
      { id: f.device, version: await version() },
    ])
    await execute(disable)
    await reject(require('../../tcp-server/ingest').lookupDeviceByKeyId(f.adapter,await scalar('select key_id from devices where id=$1',[f.device])),/authorization disabled or revoked/)
    await reject(
      require('../../tcp-server/ingest').processFrame(frame, {
        supabase: f.adapter,
        transport: 'udp',
      }),
      /authentication failed/,
    )
    const revoked = await preview('revoke', {}, [
      { id: f.device, version: await version() },
    ])
    await execute(revoked)
    await reject(require('../../tcp-server/ingest').lookupDeviceByKeyId(f.adapter,await scalar('select key_id from devices where id=$1',[f.device])),/authorization disabled or revoked/)
    await reject(
      require('../../tcp-server/ingest').processFrame(frame, {
        supabase: f.adapter,
        transport: 'udp',
      }),
      /authentication failed/,
    )
    const viewer = randomUUID()
    await db.query(
      "insert into auth.users values($1,'viewer@example.invalid')",
      [viewer],
    )
    await db.query(
      "insert into organization_members(organization_id,user_id,role)values($1,$2,'viewer')",
      [f.org, viewer],
    )
    await reject(
      preview(
        'disable',
        {},
        [{ id: f.device, version: await version() }],
        viewer,
      ),
      /FORBIDDEN/,
    )
    check(
      (
        await scalar('select fleet_inventory($1,$2,$3,0,50)', [
          f.org,
          viewer,
          '{}',
        ])
      ).total === 1,
      'viewer permitted scoped reads',
    )
    const c = credentials()
    check(
      c.root_encrypted !== credentials().root_encrypted,
      'secure independent roots',
    )
    console.log(`fleet tenant/credential/routing: ${checks} assertions passed`)
  } finally {
    await db.exec('reset role')
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
