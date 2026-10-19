const assert = require('node:assert/strict')
const { createDatabase } = require('../database.cjs')
const { randomUUID, createHash } = require('node:crypto')
process.env.TCP_CREDENTIAL_KEY = '34'.repeat(32)
process.env.STRUCT_SECURE_V2_ENABLED = 'true'
const { encryptSecret } = require('../../tcp-server/auth'),
  wire = require('../../sdk/js/secure-v2.cjs'),
  { processFrame } = require('../../tcp-server/ingest')
async function fixture(database) {
  const db = database || (await createDatabase()),
    user = randomUUID(),
    org = randomUUID(),
    device = randomUUID(),
    root = 'ab'.repeat(32)
  const scalar = async (sql, args = []) =>
    Object.values((await db.query(sql, args)).rows[0])[0]
  await db.query('insert into auth.users values($1,$2)', [
    user,
    'pipeline@example.invalid',
  ])
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
  await db.query(
    "insert into organizations(id,name) values($1,'Pipeline test')",
    [org],
  )
  await db.query(
    "insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')",
    [org, user],
  )
  await db.query(
    "insert into devices(id,user_id,organization_id,name,api_key,key_id) values($1,$2,$3,'Local sender',$4,$4)",
    [device, user, org, randomUUID()],
  )
  const credential = await scalar(
      'select row_to_json(enroll_device_secure_v2($1,$2,$3,$4,$5,$6,false,0))',
      [
        device,
        org,
        encryptSecret(root),
        'abab',
        encryptSecret('cd'.repeat(32)),
        Buffer.alloc(32, 1),
      ],
    ),
    wireId = Number(credential.wire_device_id)
  await db.query(
    "select publish_secure_v2_schema_slot($1,$2,0,'legacy-le-v1',$3,1,null,1000)",
    [device, org, JSON.stringify([{ name: 'value', type: 'uint8' }])],
  )
  const destination = await scalar(
    "insert into destinations(user_id,organization_id,name,url,signing_secret) values($1,$2,'Local receiver','https://example.com/hook','test-signing-secret') returning id",
    [user, org],
  )
  const adapter = {
    from(table) {
      assert(
        [
          'devices',
          'secure_v2_credentials',
          'secure_v2_schema_slots',
          'destinations',
        ].includes(table),
      )
      const filters = []
      const q = {
        select() {
          return q
        },
        eq(column, value) {
          assert(/^[a-z_]+$/.test(column))
          filters.push([column, value])
          return q
        },
        async maybeSingle() {
          return {
            data: (
              await db.query(
                `select * from ${table} where ${filters.map(([c], i) => `${c}=$${i + 1}`).join(' and ')}`,
                filters.map(([, v]) => v),
              )
            ).rows[0],
          }
        },
      }
      return q
    },
    async rpc(name, args = {}) {
      try {
        if (name === 'ingest_secure_v2_telemetry')
          return {
            data: await scalar(
              'select ingest_secure_v2_telemetry($1,$2,$3,$4,$5)',
              [
                args.p_wire_device_id,
                args.p_sequence,
                Buffer.from(args.p_frame_digest.slice(2), 'hex'),
                args.p_schema_slot,
                JSON.stringify(args.p_records),
              ],
            ),
          }
        assert(
          [
            'claim_webhook_deliveries_v2',
            'finish_webhook_delivery_v2',
            'expire_pending_commands',
            'delivery_pipeline_health',
          ].includes(name),
        )
        const values = Object.values(args)
        const result = await db.query(
          `select ${name === 'claim_webhook_deliveries_v2' ? '*' : name} ${name === 'claim_webhook_deliveries_v2' ? 'from ' + name + '(' : '('}${values.map((_, i) => '$' + (i + 1)).join(',')})`,
          values,
        )
        return {
          data:
            name === 'claim_webhook_deliveries_v2'
              ? result.rows
              : Object.values(result.rows[0])[0],
        }
      } catch (e) {
        return { error: { message: e.message } }
      }
    },
  }
  const frame = (sequence, values = [42]) =>
    wire.buildFrame({
      rootSecret: root,
      wireDeviceId: wireId,
      sequence,
      slot: 0,
      confirmed: true,
      batch: values.length > 1,
      payload:
        values.length > 1
          ? wire.buildBatch(values.map((v) => Buffer.from([v])))
          : Buffer.from(values),
    })
  const ingest = (sequence, values) =>
    processFrame(frame(sequence, values), {
      supabase: adapter,
      transport: 'udp',
    })
  return {
    db,
    scalar,
    user,
    org,
    device,
    root,
    wireId,
    destination,
    adapter,
    frame,
    ingest,
  }
}
module.exports = { fixture }
