const assert = require('node:assert/strict'),
  dgram = require('node:dgram'),
  { once } = require('node:events'),
  { randomUUID } = require('node:crypto')
const { fixture } = require('../pipelines/fixture.cjs'),
  { tick } = require('../../tcp-server/fleet/worker'),
  { SecureV2Client } = require('../../sdk/js/index.cjs'),
  { processFrame } = require('../../tcp-server/ingest')
async function run() {
  const f = await fixture(),
    { db, scalar } = f,
    server = dgram.createSocket('udp4'),
    rejected = []
  let checks = 0,
    sequence = 0,
    listening = false
  const check = (v, m) => {
    assert(v, m)
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
  const action = async (operation) => {
    const version = await scalar(
        'select admin_version from devices where id=$1',
        [f.device],
      ),
      job = await scalar('select fleet_preview($1,$2,$3,$4,$5,$6,null)', [
        f.org,
        f.user,
        randomUUID(),
        operation,
        '{}',
        JSON.stringify([{ id: f.device, version }]),
      ])
    await scalar("select fleet_job_action($1,$2,$3,'confirm')", [
      f.org,
      f.user,
      job,
    ])
    while (await tick(adapter)) {}
    check(
      (await scalar('select fleet_job_counts($1,$2)', [f.org, job])).updated ===
        1,
      operation + ' committed',
    )
  }
  try {
    await db.exec('update fleet_settings set enabled=true')
    server.on('message', async (frame, remote) => {
      try {
        const r = await processFrame(frame, {
          supabase: f.adapter,
          transport: 'udp',
        })
        if (r.receipt) server.send(r.receipt, remote.port, remote.address)
      } catch (e) {
        rejected.push(e.message)
      }
    })
    server.bind(0, '127.0.0.1')
    await once(server, 'listening')
    listening = true
    const wireDeviceId = Number(
        await scalar('select wire_device_id from devices where id=$1', [
          f.device,
        ]),
      ),
      client = new SecureV2Client({
        wireDeviceId,
        rootSecret: f.root,
        host: '127.0.0.1',
        port: server.address().port,
        counter: { wireDeviceId, next: () => sequence++ },
      })
    const send = (value) =>
      client.send(0, Buffer.from([value]), {
        confirmed: true,
        maxRetries: 0,
        budgetMs: 150,
      })
    check(
      (await send(42)).status === 'committed',
      'real UDP SDK authenticates database-backed commit receipt',
    )
    await action('disable')
    check(
      (await send(43)).status === 'unknown',
      'disabled device has no successful receipt',
    )
    check(
      (await scalar('select count(*)::int from telemetry where device_id=$1', [
        f.device,
      ])) === 1,
      'disabled datagram not stored',
    )
    await action('enable')
    check(
      (await send(44)).status === 'committed',
      're-enabled device continues with valid counter gaps',
    )
    await action('revoke')
    check(
      (await send(45)).status === 'unknown',
      'revoked credential cannot obtain commit receipt',
    )
    check(
      (await scalar('select count(*)::int from telemetry where device_id=$1', [
        f.device,
      ])) === 2,
      'revocation preserves prior committed telemetry',
    )
    check(
      rejected.length === 2 &&
        rejected.every((v) => v.includes('authentication failed')),
      'actual gateway safely rejects disabled/revoked datagrams',
    )
    console.log(`fleet real UDP/SDK/gateway/SQL: ${checks} assertions passed`)
  } finally {
    if (listening) await new Promise((r) => server.close(r))
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
