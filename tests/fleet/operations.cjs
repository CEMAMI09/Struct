const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { fixture } = require('../pipelines/fixture.cjs')
const { tick } = require('../../tcp-server/fleet/worker')
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
  const preview = (op, rows = [], opts = {}) =>
    scalar('select fleet_preview($1,$2,$3,$4,$5,$6,null)', [
      f.org,
      f.user,
      randomUUID(),
      op,
      JSON.stringify(opts),
      JSON.stringify(rows),
    ])
  const execute = async (id) => {
    await scalar("select fleet_job_action($1,$2,$3,'confirm')", [
      f.org,
      f.user,
      id,
    ])
    while (await tick(adapter)) {}
    return scalar('select fleet_job_counts($1,$2)', [f.org, id])
  }
  const version = (id) =>
    scalar('select admin_version from devices where id=$1', [id])
  try {
    await db.exec('update fleet_settings set enabled=true')
    await db.query(
      "update organizations set subscription_tier='scale',stripe_quantity=100 where id=$1",
      [f.org],
    )
    const g = await scalar('select fleet_group($1,$2,null,$3,0,false)', [
      f.org,
      f.user,
      'Factory A',
    ])
    const j = await preview('create', [
      { name: 'One', external_id: 'one', groups: [g], labels: ['outdoor'] },
      { name: 'Two', serial_number: 'two', lifecycle: 'disabled' },
    ])
    check(
      (await execute(j)).created === 2,
      'CSV row groups/tags/initial disabled',
    )
    const ids = (
        await db.query(
          'select device_id from fleet_job_items where job_id=$1 order by item_index',
          [j],
        )
      ).rows.map((r) => r.device_id),
      [one, two] = ids
    check(
      (await scalar(
        'select count(*)::int from device_group_members where device_id=$1',
        [one],
      )) === 1,
      'per-row group applied',
    )
    check(
      (await scalar('select labels from devices where id=$1', [one])).includes(
        'outdoor',
      ),
      'per-row label applied',
    )
    check(
      (await scalar('select lifecycle from devices where id=$1', [two])) ===
        'disabled',
      'initial disabled applied',
    )
    const duplicate = await preview(
      'create',
      [
        {
          name: 'Should not rename',
          external_id: 'one',
          description: 'approved',
          metadata: { location: 'north' },
          groups: [],
          labels: ['must-not-apply'],
        },
      ],
      { duplicates: 'metadata', labels: ['also-not-applied'] },
    )
    check(
      (await execute(duplicate)).updated === 1,
      'duplicate approved metadata policy',
    )
    const row = (await db.query('select * from devices where id=$1', [one]))
      .rows[0]
    check(
      row.name === 'One' &&
        row.description === 'approved' &&
        row.fleet_metadata.location === 'north' &&
        row.labels.join(',') === 'outdoor',
      'duplicate update preserves name/security/groups/tags',
    )
    check(
      (
        await execute(
          await preview(
            'create',
            [{ name: 'Collision', external_id: 'one', serial_number: 'two' }],
            { duplicates: 'metadata' },
          ),
        )
      ).failed === 1,
      'split identity collision rejected',
    )
    const tags = await preview(
      'labels_remove',
      [{ id: one, version: await version(one) }],
      { labels: ['outdoor'] },
    )
    check((await execute(tags)).updated === 1, 'labels removal')
    check(
      (await scalar('select labels from devices where id=$1', [one])).length ===
        0,
      'labels actually removed',
    )
    const meta = await preview(
      'metadata',
      [{ id: one, version: await version(one) }],
      { description: 'changed', metadata: { value: '9223372036854775807' } },
    )
    check((await execute(meta)).updated === 1, 'metadata update')
    check(
      (await scalar('select fleet_metadata from devices where id=$1', [one]))
        .value === '9223372036854775807',
      'metadata integer string not rounded',
    )
    const stale = await preview('disable', [
      { id: one, version: await version(one) },
    ])
    await db.query("update devices set description='newer' where id=$1", [one])
    check(
      (await execute(stale)).failed === 1,
      'stale version produces eligible failure',
    )
    const retry = await scalar('select fleet_retry_preview($1,$2,$3,$4)', [
      f.org,
      f.user,
      stale,
      randomUUID(),
    ])
    check(
      (await scalar('select status from fleet_jobs where id=$1', [retry])) ===
        'ready',
      'retry requires a new confirmation',
    )
    check(
      (await execute(retry)).updated === 1,
      'retry refreshes version and executes only failed items',
    )
    const expired = await preview('enable', [
      { id: one, version: await version(one) },
    ])
    await db.query(
      "update fleet_jobs set expires_at=now()-interval '1 second' where id=$1",
      [expired],
    )
    await reject(
      scalar("select fleet_job_action($1,$2,$3,'confirm')", [
        f.org,
        f.user,
        expired,
      ]),
      /PREVIEW_EXPIRED/,
    )
    await scalar('select fleet_cleanup()')
    check(
      (await scalar('select status from fleet_jobs where id=$1', [expired])) ===
        'expired',
      'expired previews cleaned',
    )
    const abandoned = await preview('enable', [
      { id: one, version: await version(one) },
    ])
    await scalar("select fleet_job_action($1,$2,$3,'confirm')", [
      f.org,
      f.user,
      abandoned,
    ])
    for (let i = 0; i < 3; i++) {
      check(Boolean(await scalar('select fleet_claim()')), 'recovery claim')
      await db.query(
        "update fleet_job_items set lease_until=now()-interval '1 second' where job_id=$1",
        [abandoned],
      )
    }
    await scalar('select fleet_claim()')
    check(
      (await scalar('select fleet_job_counts($1,$2)', [f.org, abandoned]))
        .failed === 1,
      'bounded crash retries terminal and visible',
    )
    check(
      (await scalar('select status from fleet_jobs where id=$1', [
        abandoned,
      ])) === 'completed_with_errors',
      'abandoned final job state',
    )
    await f.ingest(0)
    const archive = await preview('delete', [
      { id: f.device, version: await version(f.device) },
    ])
    check((await execute(archive)).updated === 1, 'archive completed')
    check(
      (await scalar('select count(*)::int from telemetry where device_id=$1', [
        f.device,
      ])) === 1,
      'archive preserves telemetry',
    )
    await reject(f.ingest(1), /authentication failed/)
    check(
      (
        await scalar('select fleet_inventory($1,$2,$3,0,50)', [
          f.org,
          f.user,
          JSON.stringify({ status: 'deleted' }),
        ])
      ).total === 1,
      'archived records searchable explicitly',
    )
    check(
      (
        await scalar('select fleet_inventory($1,$2,$3,0,50)', [
          f.org,
          f.user,
          JSON.stringify({ createdAfter: '2100-01-01T00:00:00Z' }),
        ])
      ).total === 0,
      'date filtering',
    )
    for (let i = 0; i < 5; i++)
      await scalar("select fleet_export_begin($1,$2,'metadata_export')", [
        f.org,
        f.user,
      ])
    await reject(
      scalar("select fleet_export_begin($1,$2,'metadata_export')", [
        f.org,
        f.user,
      ]),
      /EXPORT_RATE_LIMIT/,
    )
    // Terminal-job storage is capped, but old audit entries survive without their deleted FK.
    await db.query(
      "insert into fleet_jobs(organization_id,actor_id,request_id,operation,status,created_at,completed_at) select $1,$2,gen_random_uuid(),'create','completed',now()-g*interval '1 minute',now() from generate_series(1,55)g",
      [f.org, f.user],
    )
    await scalar('select fleet_cleanup()')
    check(
      (await scalar(
        "select count(*)::int from fleet_jobs where organization_id=$1 and status in ('completed','completed_with_errors','canceled','expired')",
        [f.org],
      )) === 50,
      'bounded result retention',
    )
    check(
      (await scalar(
        'select count(*)::int from fleet_audit where organization_id=$1',
        [f.org],
      )) > 10,
      'audit retained after result pruning',
    )
    console.log(`fleet operations/recovery: ${checks} assertions passed`)
  } finally {
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
