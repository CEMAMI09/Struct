// Real PostgreSQL functions/constraints, no cloud credentials or production data.
const assert = require('node:assert/strict')
const { createDatabase } = require('./database.cjs')

async function run() {
  const db = await createDatabase()
  try {
    const user = '10000000-0000-0000-0000-000000000001'
    const org = '10000000-0000-0000-0000-000000000002'
    const device = '10000000-0000-0000-0000-000000000003'
    await db.query('insert into auth.users values($1,$2)', [user, 'v2@example.invalid'])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
    await db.query('insert into organizations(id,name) values($1,$2)', [org, 'V2 local test'])
    await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')", [org, user])
    await db.query(`insert into devices(id,user_id,organization_id,name,api_key,key_id,api_secret_encrypted)
      values($1,$2,$3,'V2','securev2legacy01','securev2legacy01','v1:legacy')`, [device, user, org])
    const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
    const legacy = [{ name: 'temperature', type: 'float32' }, { name: 'humidity', type: 'float32' }, { name: 'active', type: 'boolean' }]
    await db.query('select publish_device_schema($1,$2,1)', [device, JSON.stringify(legacy)])
    const token = Buffer.alloc(32, 1)
    const enroll = (rotate = false, grace = 0, hash = token) => scalar(
      'select row_to_json(enroll_device_secure_v2($1,$2,$3,$4,$5,$6,$7,$8))',
      [device, org, 'v1:test-root', 'abcd', 'v1:test-bootstrap', hash, rotate, grace],
    )
    const credential = await enroll()
    const wire = Number(credential.wire_device_id)
    assert(wire > 0 && wire <= 0xffffffff)
    assert.equal(await scalar('select api_secret_encrypted from devices where id=$1', [device]), 'v1:legacy')
    assert.equal(await scalar('select protocol_version from devices where id=$1', [device]), 2)
    await assert.rejects(enroll(), /ALREADY_ENROLLED/)
    await assert.rejects(enroll(true, 86401), /INVALID_SECURE_V2_CREDENTIAL/)
    const bootstrap = () => scalar('select bootstrap_secure_v2_counter($1,$2)', [wire, token])
    await assert.rejects(db.query('select bootstrap_secure_v2_counter($1,$2)', [wire, Buffer.alloc(32, 2)]), /INVALID_PROVISIONING_REQUEST/)
    assert.deepEqual(await bootstrap(), { nextSequence: 0 })
    await assert.rejects(bootstrap(), /INVALID_PROVISIONING_REQUEST/)

    const publish = (slot = 0, definition = legacy, bytes = 9) => scalar(
      'select row_to_json(publish_secure_v2_schema_slot($1,$2,$3,$4,$5,$6,1,null))',
      [device, org, slot, 'legacy-le-v1', JSON.stringify(definition), bytes],
    )
    await publish()
    assert.equal((await publish()).record_bytes, 9)
    await assert.rejects(publish(0, [{ name: 'changed', type: 'uint8' }], 1), /LEGACY_SCHEMA_MISMATCH|ALREADY_ASSIGNED/)
    await assert.rejects(publish(16), /INVALID_SECURE_V2_SCHEMA/)
    await db.query('select publish_secure_v2_schema_slot($1,$2,1,$3,$4,3,null,1000)',
      [device, org, 'bitpacked-v1', JSON.stringify([{ name: 'active', type: 'boolean' }])])
    await assert.rejects(db.query('select publish_secure_v2_schema_slot($1,$2,1,$3,$4,4,null,1000)',
      [device, org, 'bitpacked-v1', JSON.stringify([{ name: 'active', type: 'boolean' }])]), /ALREADY_ASSIGNED/)
    await db.query(`insert into destinations(user_id,organization_id,name,url,event_types)
      values($1,$2,'V2 webhook','https://receiver.example.invalid/events',array['telemetry.received'])`, [user, org])
    const commit = (sequence, records = [{ temperature: 23.5, humidity: 50, active: true }], id = wire, digest = Buffer.alloc(32, sequence % 255), slot = 0) =>
      scalar('select ingest_secure_v2_telemetry($1,$2,$3,$4,$5)', [id, sequence, digest, slot, JSON.stringify(records)])
    const first = await commit(0)
    assert.equal(first.inserted, true)
    assert.equal(first.event_ids.length, 1)
    const duplicate = await commit(0)
    assert.equal(duplicate.duplicate, true)
    assert.deepEqual(duplicate.event_ids, first.event_ids)
    assert.equal(await scalar('select count(*)::integer from telemetry'), 1)
    assert.equal(await scalar('select count(*)::integer from webhook_deliveries'), 1)
    await assert.rejects(commit(0, [{}], wire, Buffer.alloc(32, 99)), /SEQUENCE_CONFLICT/)
    assert.equal((await commit(5)).replay, 'new')
    assert.equal((await commit(3)).replay, 'out_of_order')
    assert.equal((await commit(3)).replay, 'duplicate')
    await commit(69)
    await assert.rejects(commit(5), /STALE_REPLAY/)
    await assert.rejects(commit(0), /STALE_REPLAY/)
    assert.equal((await commit(6)).replay, 'out_of_order') // offset63 accepted;64 stale
    assert.equal((await commit(6)).duplicate, true)
    await assert.rejects(commit(70, [{}], wire, Buffer.alloc(32), 15), /UNKNOWN_SECURE_V2_SCHEMA_SLOT/)
    await assert.rejects(commit(70, []), /INVALID_SECURE_V2_TELEMETRY/)
    await assert.rejects(commit(70, [true]), /INVALID_SECURE_V2_TELEMETRY/)
    await assert.rejects(commit(0x100000000), /INVALID_SECURE_V2_TELEMETRY/)

    // Storage/outbox/window are one transaction even if a later batch row fails.
    const before = await scalar('select count(*)::integer from telemetry')
    const outboxBefore = await scalar('select count(*)::integer from webhook_deliveries')
    await db.exec(`create function fail_v2_test_insert() returns trigger language plpgsql as $$
      begin if new.parsed_json ? 'fail' then raise exception 'V2 storage outage'; end if; return new; end $$;
      create trigger v2_storage_outage before insert on telemetry for each row execute function fail_v2_test_insert();`)
    await assert.rejects(commit(70, [{ active: true }, { fail: true }]), /storage outage/)
    assert.equal(Number(await scalar('select highest_sequence from secure_v2_replay_state where wire_device_id=$1', [wire])), 69)
    assert.equal(await scalar('select count(*)::integer from telemetry'), before)
    assert.equal(await scalar('select count(*)::integer from webhook_deliveries'), outboxBefore)
    await db.exec('drop trigger v2_storage_outage on telemetry')
    const batch = await commit(70, [{ active: true }, { active: false }], wire, Buffer.alloc(32, 70), 1)
    assert.equal(batch.event_ids.length, 2)
    assert.equal((await commit(70, [{ active: true }, { active: false }], wire, Buffer.alloc(32, 70), 1)).duplicate, true)
    assert.equal(await scalar('select count(*)::integer from telemetry'), before + 2)
    assert.equal(await scalar('select count(*)::integer from webhook_deliveries'), outboxBefore + 2)
    const times = (await db.query('select timestamp from telemetry where secure_v2_sequence=70 order by secure_v2_record_index')).rows
    assert.equal(new Date(times[1].timestamp) - new Date(times[0].timestamp), 1000)
    const simultaneous = await Promise.all([commit(71), commit(71)])
    assert.equal(simultaneous.filter(row => row.inserted).length, 1)
    assert.equal(simultaneous.filter(row => row.duplicate).length, 1)
    await commit(72, Array.from({ length: 255 }, (_, reading) => ({ reading })))
    await assert.rejects(commit(73, Array(256).fill({})), /INVALID_SECURE_V2_TELEMETRY/)

    const rotated = await enroll(true, 0, Buffer.alloc(32, 2))
    const nextWire = Number(rotated.wire_device_id)
    assert.notEqual(nextWire, wire)
    await assert.rejects(commit(73), /INVALID_SECURE_V2_CREDENTIAL/)
    assert.equal((await commit(0, [{}], nextWire)).inserted, true)
    const grace = await enroll(true, 60, Buffer.alloc(32, 3))
    assert.equal((await commit(1, [{}], nextWire)).inserted, true)
    assert.equal((await commit(0, [{}], Number(grace.wire_device_id))).inserted, true)
    await assert.rejects(db.query('select bootstrap_secure_v2_counter($1,$2)', [Number(grace.wire_device_id), Buffer.alloc(32, 3)]), /INVALID_PROVISIONING_REQUEST/)
    await db.query("update secure_v2_credentials set expires_at=now()-interval '1 second' where wire_device_id=$1", [nextWire])
    await assert.rejects(commit(2, [{}], nextWire), /INVALID_SECURE_V2_CREDENTIAL/)
    // Even after retention removes rows, high water still rejects stale replay.
    await db.exec('delete from telemetry')
    await assert.rejects(commit(0), /INVALID_SECURE_V2_CREDENTIAL/)
    await commit(1000, [{}], Number(grace.wire_device_id))
    await assert.rejects(commit(0, [{}], Number(grace.wire_device_id)), /STALE_REPLAY/)
    assert.equal(await scalar('select count(*)::integer from secure_v2_packets where wire_device_id=$1', [Number(grace.wire_device_id)]), 1)
    await assert.rejects(db.query('insert into telemetry(device_id,parsed_json,secure_v2_wire_device_id) values($1,$2,$3)',
      [device, '{}', Number(grace.wire_device_id)]), /telemetry_secure_v2_identity/)

    const signatures = [
      'enroll_device_secure_v2(uuid,uuid,text,text,text,bytea,boolean,integer)',
      'bootstrap_secure_v2_counter(bigint,bytea)',
      'publish_secure_v2_schema_slot(uuid,uuid,integer,text,jsonb,integer,integer,integer)',
      'ingest_secure_v2_telemetry(bigint,bigint,bytea,integer,jsonb)',
    ]
    for (const role of ['anon', 'authenticated']) {
      for (const signature of signatures) assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, 'public.' + signature]), false)
      for (const table of ['secure_v2_credentials', 'secure_v2_replay_state', 'secure_v2_packets'])
        assert.equal(await scalar("select has_table_privilege($1,$2,'SELECT')", [role, 'public.' + table]), false)
    }
    await db.exec('set role service_role')
    await assert.rejects(db.exec('update secure_v2_schema_slots set record_bytes=4'), /permission denied/)
    await assert.rejects(db.exec('delete from secure_v2_schema_slots'), /permission denied/)
    await db.exec('reset role')
    console.log('secure-v2 database: enrollment, immutable slots, one-use bootstrap, atomic replay/batches/outbox, rotation, retention and grants passed')
  } finally { await db.close() }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
