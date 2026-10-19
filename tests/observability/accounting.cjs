const assert = require('node:assert/strict'),
  { setup } = require('./fixture.cjs'),
  { processFrame } = require('../../tcp-server/ingest')
const wire = require('../../sdk/js/secure-v2.cjs'),
  packed = require('../../protocol/schema/bitpacked.cjs'),
  { startUdpServer } = require('../../tcp-server/udp'),
  { SecureV2Client } = require('../../sdk/js/index.cjs'),
  { once } = require('node:events'),
  { flush } = require('../../tcp-server/observability/collector')
async function run() {
  process.env.STRUCT_OBSERVABILITY_ENABLED = 'true'
  const f = await setup(),
    { db, scalar } = f
  let n = 0
  const check = (v, m) => {
    assert(v, m)
    n++
  }
  let server
  try {
    const original = [
        { name: 'temperature', type: 'float32' },
        { name: 'humidity', type: 'float32' },
        { name: 'is_active', type: 'boolean' },
      ],
      optimized = [
        {
          name: 'temperature',
          type: 'fixed',
          min: -40,
          max: 125,
          precision: 0.1,
        },
        { name: 'humidity', type: 'fixed', min: 0, max: 100, precision: 0.1 },
        { name: 'is_active', type: 'boolean' },
      ]
    for (const [slot, encoding, definition] of [
      [1, 'legacy-le-v1', original],
      [2, 'bitpacked-v1', optimized],
    ])
      await scalar(
        'select publish_secure_v2_schema_slot($1,$2,$3,$4,$5,1,null,1000)',
        [f.device, f.org, slot, encoding, JSON.stringify(definition)],
      )
    const bytes = Buffer.alloc(9)
    bytes.writeFloatLE(23.5, 0)
    bytes.writeFloatLE(61.25, 4)
    bytes[8] = 1
    const compact = Buffer.from(
      packed.encodePayload(
        { temperature: 23.5, humidity: 61.25, is_active: true },
        optimized,
      ),
    )
    check(
      bytes.length === 9 && compact.length === 3,
      'real original and optimized encoding',
    )
    for (const [sequence, slot, payload, expected] of [
      [0, 1, bytes, 34],
      [1, 2, compact, 28],
    ]) {
      const frame = wire.buildFrame({
        rootSecret: f.root,
        wireDeviceId: f.wireId,
        sequence,
        slot,
        payload,
      })
      const r = await processFrame(frame, {
        supabase: f.adapter,
        transport: 'udp',
        ipVersion: 4,
      })
      check(frame.length === expected, 'measured frame length')
      check(r.records[0].temperature === 23.5, 'decoded temperature')
      if (slot === 2)
        check(
          Math.abs(r.records[0].humidity - 61.3) < 1e-12,
          'explicit lossy precision preserved',
        )
    }
    await scalar('select aggregate_metric_events(100)')
    const usage = await scalar(
      "select usage_analytics($1,$2,now()-interval '1 hour',now()+interval '1 minute')",
      [f.org, f.user],
    )
    check(
      usage.buckets[0].application === '62' &&
        usage.buckets[0].ip_overhead === '56',
      '34+28 observed and two minimum IPv4 UDP headers',
    )
    const rows = (
      await db.query(
        'select app_bytes::int,payload_bytes::int,framing_bytes::int,security_bytes::int from metric_events order by id',
      )
    ).rows
    check(
      rows[0].app_bytes + 28 === 62 && rows[1].app_bytes + 28 === 56,
      'historical reference validated from actual encoders',
    )
    server = startUdpServer(f.adapter, { port: 0 })
    await once(server.socket, 'listening')
    let seq = 2
    const client = new SecureV2Client({
      wireDeviceId: f.wireId,
      rootSecret: f.root,
      host: '127.0.0.1',
      port: server.socket.address().port,
      counter: { wireDeviceId: f.wireId, next: () => seq++ },
    })
    const result = await client.send(1, bytes, {
      confirmed: true,
      maxRetries: 0,
      budgetMs: 1000,
    })
    check(result.status === 'committed', 'real UDP observed RPC receipt')
    await new Promise((r) => setImmediate(r))
    await flush(f.adapter)
    check(
      (await scalar(
        "select sum(receipt_bytes)::int from metric_events where kind='receipt'",
      )) === 21,
      'actual socket-submitted receipt bytes',
    )
    await scalar('select aggregate_metric_events(100)')
    const total = await scalar(
      "select sum(receipt_bytes)::text from usage_rollups where grain='hour'",
    )
    check(total === '21', 'receipt rollup separate from uplink')
    await db.exec(
      "create function test_analytics_fail() returns trigger language plpgsql as $$begin raise exception 'optional analytics failure';end$$;create trigger test_analytics_failure before insert on metric_events for each row execute function test_analytics_fail()",
    )
    check(
      (
        await client.send(1, bytes, {
          confirmed: true,
          maxRetries: 0,
          budgetMs: 1000,
        })
      ).status === 'committed',
      'analytics failure never invalidates a committed receipt',
    )
    check(
      (await scalar('select count(*)::int from telemetry')) === 4,
      'telemetry survives optional metrics failure',
    )
    check(
      (await scalar('select sum(events)::int from metric_gaps')) === 1,
      'durable commit metadata gap exposed',
    )
    await db.exec('drop trigger test_analytics_failure on metric_events')
    const originalRpc = f.adapter.rpc
    f.adapter.rpc = async (name, args) =>
      name === 'ingest_secure_v2_observed'
        ? { error: { message: 'Simulated database transport unavailable' } }
        : originalRpc(name, args)
    check(
      (
        await client.send(1, bytes, {
          confirmed: true,
          maxRetries: 0,
          budgetMs: 150,
        })
      ).status === 'unknown',
      'database transport outage never produces a false commit receipt',
    )
    check(
      (await scalar('select count(*)::int from telemetry')) === 4,
      'failed commit does not store a reading',
    )
    f.adapter.rpc = originalRpc
    console.log(`PASS ${n} real serializer/UDP/byte/optional-failure checks`)
  } finally {
    if (server) await new Promise((r) => server.socket.close(r))
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
