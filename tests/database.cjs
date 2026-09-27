// Runs real PostgreSQL migration/function logic locally, with no cloud credentials.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')

async function createDatabase(throughMigration = '999') {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon, service_role;
    create publication supabase_realtime;
    -- Test-only stand-in for pgcrypto, used solely by migration 017 defaults.
    -- Cryptography is tested against Node and mbedTLS, not this fixture.
    create function gen_random_bytes(integer) returns bytea language sql as
      $$ select decode(repeat('ab', $1), 'hex') $$;
  `)
  const dir = path.join(__dirname, '../supabase/migrations')
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql') && f.slice(0, 3) <= throughMigration).sort()) {
    let sql = fs.readFileSync(path.join(dir, file), 'utf8')
    // PGlite has built-in gen_random_uuid, but no Supabase extension scheduler.
    sql = sql.replace(/create extension if not exists "pgcrypto";/i, '')
    if (file.startsWith('015_')) sql = sql.slice(0, sql.indexOf('-- Supabase supports pg_cron'))
    try { await db.exec(sql) } catch (e) { await db.close(); throw new Error(`${file}: ${e.message}`) }
  }
  return db
}

async function run() {
  const db = await createDatabase()
  try {
    const user = '00000000-0000-0000-0000-000000000001'
    const org = '00000000-0000-0000-0000-000000000002'
    const device = '00000000-0000-0000-0000-000000000003'
    await db.query('insert into auth.users values ($1, $2)', [user, 'local-test@example.invalid'])
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
    await db.query('insert into organizations(id, name) values ($1, $2)', [org, 'Local test'])
    await db.query("insert into organization_members(organization_id, user_id, role) values ($1, $2, 'owner')", [org, user])
    await db.query('insert into devices(id, user_id, organization_id, name, api_key, key_id) values ($1,$2,$3,$4,$5,$5)', [device, user, org, 'Sensor', '0123456789abcdef'])
    const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
    const publish = async (fields, version) => scalar('select (publish_device_schema($1,$2,$3)).version', [device, JSON.stringify(fields), version])
    const schema = [{ name: 'temperature', type: 'float32' }]
    assert.equal(await publish(schema, 1), 1)
    assert.equal(await publish(schema, 1), 1)
    assert.equal(await publish([...schema, { name: 'alive', type: 'boolean' }], 1), 2)
    assert.equal(await scalar('select count(*)::integer from schema_versions'), 2)
    assert.deepEqual(await scalar('select schema_definition from schema_versions where version = 1'), schema)
    await assert.rejects(publish(schema, 1), /refresh/)
    await assert.rejects(publish([{ name: 'same', type: 'uint8' }, { name: 'same', type: 'uint8' }], 2), /duplicate/)
    await assert.rejects(publish([{ name: 'bits', type: 'flags', bits: [{ name: 'x', bit: 1.5 }] }], 2), /flag/)
    assert.equal(await scalar('select version from schemas'), 2)

    const nonce = Buffer.alloc(12, 1), digest = Buffer.alloc(32, 2)
    const commit = async (n = nonce, d = digest) => scalar('select ingest_device_telemetry($1,$2,now(),$3,$4,60)', [device, n, d, '{"temperature":23.5}'])
    assert.equal(await commit(), true)
    assert.equal(await commit(), false)
    assert.equal(await scalar('select count(*)::integer from telemetry'), 1)
    await assert.rejects(commit(nonce, Buffer.alloc(32, 3)), /NONCE_CONFLICT/)
    await assert.rejects(db.query("select ingest_device_telemetry($1,$2,now()-interval '2 minutes',$3,$4,60)", [device, nonce, digest, '{}']), /TIMESTAMP_SKEW/)
    await assert.rejects(db.query('select ingest_device_telemetry($1,$2,null,$3,$4,60)', [device, nonce, digest, '{}']), /INVALID_TELEMETRY/)

    await db.exec("create function fail_test_insert() returns trigger language plpgsql as $$ begin raise exception 'test storage outage'; end $$; create trigger test_outage before insert on telemetry for each row execute function fail_test_insert();")
    await assert.rejects(commit(Buffer.alloc(12, 4)), /storage outage/)
    assert.equal(await scalar('select count(*)::integer from device_replay_nonces'), 1)
    await db.exec('drop trigger test_outage on telemetry')
    assert.equal(await commit(Buffer.alloc(12, 4)), true)
    assert.equal(await scalar('select count(*)::integer from telemetry'), 2)

    for (const role of ['anon', 'authenticated']) {
      for (const signature of ['bulk_insert_devices(uuid,uuid,jsonb,integer)', 'bulk_provision_profile_devices(uuid,uuid,uuid,jsonb,integer)']) {
        assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, `public.${signature}`]), false)
        assert.equal(await scalar("select has_function_privilege('service_role',$1,'EXECUTE')", [`public.${signature}`]), true)
      }
      assert.equal(await scalar("select has_function_privilege($1,'public.ingest_device_telemetry(uuid,bytea,timestamptz,bytea,jsonb,integer)','EXECUTE')", [role]), false)
      assert.equal(await scalar("select has_function_privilege($1,'public.zero_touch_register_device(uuid,text,text,text,text,text)','EXECUTE')", [role]), false)
      assert.equal(await scalar("select has_function_privilege($1,'public.claim_pending_downlinks(uuid,text,integer)','EXECUTE')", [role]), false)
    }
    await db.exec('set role authenticated')
    await assert.rejects(db.exec("update schema_versions set schema_definition = '[]'"), /permission denied/)
    await db.exec('reset role')

    // A profile identity is the exact decoded value. Case or separators must
    // never cause two physical units to share a row (or a billing count).
    const profile = '00000000-0000-0000-0000-000000000004'
    await db.query("update organizations set subscription_tier = 'flexible', stripe_quantity = 5 where id = $1", [org])
    await db.query(
      `insert into device_profiles
        (id, organization_id, user_id, name, schema_definition, identity_field,
         fleet_key_id, fleet_secret_encrypted)
       values ($1, $2, $3, 'Profile', $4::jsonb, 'device_id', $5, 'encrypted')`,
      [profile, org, user, JSON.stringify([{ name: 'device_id', type: 'char', length: 8 }]), 'fleetkey00000001'],
    )
    const register = (hardwareId, key) => scalar(
      'select (zero_touch_register_device($1,$2,null::text,$3,$4,null::text)).id',
      [profile, hardwareId, key, 'encrypted'],
    )
    const first = await register('AB-CD', '0000000000000001')
    const second = await register('ABCD', '0000000000000002')
    const third = await register('AB', '0000000000000003')
    const fourth = await register('ab', '0000000000000004')
    assert.equal(new Set([first, second, third, fourth]).size, 4)
    assert.equal(await register('AB-CD', '0000000000000005'), first)
    await assert.rejects(register('A\tB', '0000000000000005'), /hardware_id/)

    const beforeBulk = await scalar('select count(*)::integer from devices where organization_id = $1', [org])
    const bulkRows = [
      { name: 'Unit Q-Q', hardware_id: 'Q-Q', key_id: '0000000000000006', api_secret_encrypted: 'encrypted' },
      { name: 'Unit QQ', hardware_id: 'QQ', key_id: '0000000000000007', api_secret_encrypted: 'encrypted' },
    ]
    const provisioned = await db.query(
      'select hardware_id from bulk_provision_profile_devices($1,$2,$3,$4::jsonb,$5)',
      [org, user, profile, JSON.stringify(bulkRows), beforeBulk],
    )
    assert.deepEqual(provisioned.rows.map((row) => row.hardware_id).sort(), ['Q-Q', 'QQ'])
    assert.equal(await scalar('select count(*)::integer from devices where organization_id = $1', [org]), beforeBulk + 2)

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", ['00000000-0000-0000-0000-000000000099'])
    await assert.rejects(publish(schema, 2), /Not authorized/)
    console.log('database: migrations, immutable schemas, receipts, opaque fleet IDs and RPC permissions passed')
  } finally { await db.close() }
}
module.exports = { createDatabase }
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1 })
