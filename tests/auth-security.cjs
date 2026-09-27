// Regression tests for the PostgREST roles, not merely RLS policy definitions.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createDatabase } = require('./database.cjs')

const ids = {
  owner: '20000000-0000-0000-0000-000000000001',
  admin: '20000000-0000-0000-0000-000000000002',
  viewer: '20000000-0000-0000-0000-000000000003',
  outsider: '20000000-0000-0000-0000-000000000004',
  org: '20000000-0000-0000-0000-000000000005',
  otherOrg: '20000000-0000-0000-0000-000000000006',
  device: '20000000-0000-0000-0000-000000000007',
  otherDevice: '20000000-0000-0000-0000-000000000008',
  destination: '20000000-0000-0000-0000-000000000009',
  profile: '20000000-0000-0000-0000-000000000010',
  freeOrg: '20000000-0000-0000-0000-000000000011',
}

async function run() {
  // Seed before the hardening migration so historical audit redaction is tested.
  const db = await createDatabase('025')
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
  const asUser = async (user) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
  }
  try {
    for (const [role, id] of Object.entries(ids).filter(([role]) => ['owner', 'admin', 'viewer', 'outsider'].includes(role))) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${role}@example.invalid`])
    }
    await asUser(ids.owner)
    await db.query("insert into organizations(id,name,subscription_tier,stripe_customer_id) values($1,'Tenant','scale','cus_sensitive')", [ids.org])
    await db.query("insert into organizations(id,name,subscription_tier) values($1,'Other','pro')", [ids.otherOrg])
    await db.query("insert into organizations(id,name,subscription_tier) values($1,'Free','free')", [ids.freeOrg])
    await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')", [ids.org, ids.owner])
    await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')", [ids.freeOrg, ids.owner])
    await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'admin')", [ids.org, ids.admin])
    await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'viewer')", [ids.org, ids.viewer])
    await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')", [ids.otherOrg, ids.outsider])
    await db.query("insert into devices(id,user_id,organization_id,name,api_key,key_id,encryption_key,api_secret_encrypted) values($1,$2,$3,'Sensor','sensor-key','sensor-key',$4,'ciphertext')", [ids.device, ids.owner, ids.org, 'ab'.repeat(32)])
    await db.query("insert into devices(id,user_id,organization_id,name,api_key,key_id) values($1,$2,$3,'Other','other-key','other-key')", [ids.otherDevice, ids.outsider, ids.otherOrg])
    await db.query("insert into device_profiles(id,organization_id,user_id,name,fleet_key_id,fleet_secret_encrypted) values($1,$2,$3,'Fleet','0123456789abcdef','fleet-ciphertext')", [ids.profile, ids.org, ids.owner])
    await db.query("insert into destinations(id,user_id,organization_id,name,url,signing_secret) values($1,$2,$3,'Hook','https://example.com/hook?token=secret','webhook-secret')", [ids.destination, ids.owner, ids.org])
    const firstEvent = (await db.query("insert into telemetry(device_id,parsed_json) values($1,'{}') returning id", [ids.device])).rows[0]
    const firstDelivery = (await db.query('select id from webhook_deliveries where event_id=$1', [firstEvent.id])).rows[0]

    assert.match(JSON.stringify((await db.query("select new_data from audit_logs where table_name='devices' order by created_at limit 1")).rows), /ciphertext/)
    assert.match(JSON.stringify((await db.query("select new_data from audit_logs where table_name='destinations' order by created_at limit 1")).rows), /webhook-secret/)

    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/026_authorization_and_retention.sql'), 'utf8')
    await db.exec(migration)
    // Match the Supabase postgres defaults that would otherwise reopen access
    // to every future public object.
    await db.exec(`
      alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
      alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;
      alter default privileges for role postgres in schema public grant all on functions to anon, authenticated;
      grant all on all tables in schema public to anon;
      grant truncate, references, trigger on all tables in schema public to authenticated;
      grant insert, update, delete on public.bulk_device_imports, public.device_event_ids,
        public.device_replay_nonces, public.organization_device_usage_periods,
        public.packet_traces, public.telemetry, public.trace_event_links,
        public.webhook_attempts, public.webhook_deliveries to authenticated;
    `)
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/029_telemetry_policy_cleanup.sql'), 'utf8'))
    await db.exec(`
      create table public.future_privilege_probe(id integer);
      create function public.future_privilege_probe() returns integer language sql as $$ select 1 $$;
    `)
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await scalar("select has_table_privilege($1,'public.future_privilege_probe','SELECT')", [role]), false)
      assert.equal(await scalar("select has_function_privilege($1,'public.future_privilege_probe()','EXECUTE')", [role]), false)
    }
    await db.exec('drop function public.future_privilege_probe(); drop table public.future_privilege_probe;')

    const clientTablePrivileges = await db.query(`
      select c.relname as table_name,
        has_table_privilege('anon',c.oid,'SELECT') as anon_select,
        has_table_privilege('anon',c.oid,'INSERT') as anon_insert,
        has_table_privilege('anon',c.oid,'UPDATE') as anon_update,
        has_table_privilege('anon',c.oid,'DELETE') as anon_delete,
        has_table_privilege('anon',c.oid,'TRUNCATE') as anon_truncate,
        has_table_privilege('anon',c.oid,'TRIGGER') as anon_trigger,
        has_table_privilege('anon',c.oid,'REFERENCES') as anon_references,
        has_table_privilege('authenticated',c.oid,'TRUNCATE') as auth_truncate,
        has_table_privilege('authenticated',c.oid,'TRIGGER') as auth_trigger,
        has_table_privilege('authenticated',c.oid,'REFERENCES') as auth_references
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p')
    `)
    for (const table of clientTablePrivileges.rows) {
      assert.equal(table.anon_select, false, `${table.table_name} readable by anon`)
      assert.equal(table.anon_insert, false, `${table.table_name} writable by anon`)
      assert.equal(table.anon_update, false, `${table.table_name} updateable by anon`)
      assert.equal(table.anon_delete, false, `${table.table_name} deletable by anon`)
      assert.equal(table.anon_truncate, false, `${table.table_name} truncatable by anon`)
      assert.equal(table.anon_trigger, false, `${table.table_name} triggerable by anon`)
      assert.equal(table.anon_references, false, `${table.table_name} referenceable by anon`)
      assert.equal(table.auth_truncate, false, `${table.table_name} truncatable by authenticated`)
      assert.equal(table.auth_trigger, false, `${table.table_name} triggerable by authenticated`)
      assert.equal(table.auth_references, false, `${table.table_name} referenceable by authenticated`)
    }
    for (const table of ['bulk_device_imports', 'device_event_ids', 'device_replay_nonces',
      'organization_device_usage_periods', 'packet_traces', 'telemetry', 'trace_event_links',
      'webhook_attempts', 'webhook_deliveries']) {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
        assert.equal(await scalar(`select has_table_privilege('authenticated','public.${table}',$1)`, [privilege]), false)
      }
    }
    assert.equal(await scalar("select count(*)::integer from pg_policies where tablename='telemetry' and policyname like 'Users % telemetry of own devices'"), 0)
    assert.equal(await scalar("select count(*)::integer from pg_policies where tablename='telemetry' and cmd='SELECT'"), 1)

    for (const field of ['encryption_key', 'api_secret_encrypted']) {
      assert.equal(await scalar("select has_column_privilege('authenticated','public.devices',$1,'SELECT')", [field]), false)
    }
    assert.equal(await scalar("select has_column_privilege('authenticated','public.device_profiles','fleet_secret_encrypted','SELECT')"), false)
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(await scalar("select has_table_privilege('authenticated','public.device_profiles',$1)", [privilege]), false)
    }
    assert.equal(await scalar("select has_column_privilege('authenticated','public.destinations','signing_secret','SELECT')"), false)
    assert.equal(await scalar("select has_column_privilege('authenticated','public.destinations','url','SELECT')"), false)
    assert.equal(await scalar("select has_column_privilege('authenticated','public.webhook_deliveries','destination_url','SELECT')"), false)
    assert.equal(await scalar("select has_column_privilege('authenticated','public.webhook_deliveries','lease_token','SELECT')"), false)
    for (const field of ['subscription_tier', 'stripe_customer_id', 'stripe_subscription_id', 'stripe_item_id', 'stripe_quantity']) {
      assert.equal(await scalar("select has_column_privilege('authenticated','public.organizations',$1,'UPDATE')", [field]), false)
    }
    assert.equal(await scalar("select has_table_privilege('authenticated','public.telemetry','INSERT')"), false)
    assert.equal(await scalar("select has_table_privilege('authenticated','public.organization_members','INSERT')"), false)
    assert.equal(await scalar("select has_table_privilege('authenticated','public.organization_members','DELETE')"), false)
    assert.equal(await scalar("select count(*)::integer from pg_publication_tables where pubname='supabase_realtime' and tablename='devices'"), 0)

    for (const log of (await db.query("select previous_data,new_data from audit_logs where table_name in ('devices','destinations')")).rows) {
      const text = JSON.stringify(log)
      for (const secret of ['ciphertext', 'webhook-secret', 'token=secret', 'abababab']) {
        assert.equal(text.includes(secret), false, `${secret} remained in audit history`)
      }
    }

    await db.exec('set role authenticated')
    await asUser(ids.owner)
    await assert.rejects(db.exec('truncate public.telemetry'), /permission denied/)
    assert.equal((await db.query('select id from telemetry where id=$1', [firstEvent.id])).rows.length, 1)
    assert.equal((await db.query('delete from organizations where id=$1 returning id', [ids.org])).rows.length, 0)
    assert.equal((await db.query('delete from organizations where id=$1 returning id', [ids.freeOrg])).rows.length, 1)
    await assert.rejects(db.query("update organizations set stripe_customer_id='cus_other' where id=$1", [ids.org]), /permission denied/)
    await assert.rejects(db.query("update organizations set subscription_tier='free' where id=$1", [ids.org]), /permission denied/)
    await assert.rejects(db.query("insert into organizations(name,subscription_tier) values('Unclaimed','scale')"), /permission denied/)
    await assert.rejects(db.query("insert into telemetry(device_id,parsed_json) values($1,'{}')", [ids.device]), /permission denied/)
    await assert.rejects(db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')", [ids.org, ids.outsider]), /permission denied/)
    await assert.rejects(db.query('select encryption_key from devices where id=$1', [ids.device]), /permission denied/)
    await assert.rejects(db.query('select fleet_secret_encrypted from device_profiles where id=$1', [ids.profile]), /permission denied/)
    await assert.rejects(db.query("update device_profiles set fleet_secret_encrypted='forged' where id=$1", [ids.profile]), /permission denied/)
    await assert.rejects(db.query("insert into device_profiles(organization_id,user_id,name,fleet_key_id,fleet_secret_encrypted) values($1,$2,'Forged','fedcba9876543210','forged')", [ids.org, ids.owner]), /permission denied/)
    await assert.rejects(db.query('select signing_secret from destinations where id=$1', [ids.destination]), /permission denied/)
    await assert.rejects(db.query('select url from destinations where id=$1', [ids.destination]), /permission denied/)
    await assert.rejects(db.query('select destination_url from webhook_deliveries where id=$1', [firstDelivery.id]), /permission denied/)
    await assert.rejects(db.query("update devices set encryption_key='00' where id=$1", [ids.device]), /permission denied/)
    await assert.rejects(db.query("update destinations set signing_secret='weak' where id=$1", [ids.destination]), /permission denied/)
    assert.equal(await scalar('select get_device_encryption_key($1)', [ids.device]), 'ab'.repeat(32))
    assert.equal(await scalar('select get_destination_signing_secret($1)', [ids.destination]), 'webhook-secret')
    assert.equal(await scalar('select get_destination_url($1)', [ids.destination]), 'https://example.com/hook?token=secret')
    assert.equal(await scalar('select get_webhook_delivery_destination_url($1)', [firstDelivery.id]), 'https://example.com/hook?token=secret')
    assert.equal((await db.query('select id,name,key_id,encryption_enabled from devices where id=$1', [ids.device])).rows.length, 1)
    assert.equal((await db.query("update devices set tags='{\"zone\":\"west\"}' where id=$1 returning id,tags", [ids.device])).rows[0].id, ids.device)
    assert.equal((await db.query("update organizations set name='Renamed' where id=$1 returning name", [ids.org])).rows[0].name, 'Renamed')
    const newKey = await scalar('select configure_device_encryption($1,true,true)', [ids.device])
    assert.match(newKey, /^[0-9a-f]{64}$/)
    assert.equal(await scalar('select get_device_encryption_key($1)', [ids.device]), newKey)
    assert.equal(await scalar('select configure_device_encryption($1,false,false)', [ids.device]), null)
    assert.equal(await scalar('select get_device_encryption_key($1)', [ids.device]), newKey)

    await asUser(ids.admin)
    await assert.rejects(db.query("select add_org_member_by_email($1,'owner@example.invalid','admin')", [ids.org]), /Only owners can change roles/)
    await assert.rejects(db.query("insert into destinations(user_id,organization_id,name,url,device_id) values($1,$2,'Bad','https://example.com',$3)", [ids.admin, ids.org, ids.otherDevice]), /row-level security/)
    assert.equal((await db.query("insert into destinations(user_id,organization_id,name,url) values($1,$2,'Good','https://example.com') returning id,name", [ids.admin, ids.org])).rows.length, 1)
    assert.equal(await scalar('select get_destination_signing_secret($1)', [ids.destination]), 'webhook-secret')

    await asUser(ids.viewer)
    assert.equal((await db.query('select id from telemetry where id=$1', [firstEvent.id])).rows.length, 1)
    assert.equal((await db.query('select id,name from devices where id=$1', [ids.device])).rows.length, 1)
    assert.equal((await db.query('select id,name,fleet_key_id,fleet_secret_preview from device_profiles where id=$1', [ids.profile])).rows.length, 1)
    assert.equal(JSON.stringify((await db.query("select previous_data,new_data from audit_logs where table_name='devices'")).rows).includes(newKey), false)
    await assert.rejects(db.query('select get_device_encryption_key($1)', [ids.device]), /Not authorized/)
    await assert.rejects(db.query('select get_destination_signing_secret($1)', [ids.destination]), /Not authorized/)
    await assert.rejects(db.query('select get_destination_url($1)', [ids.destination]), /Not authorized/)
    await assert.rejects(db.query('select get_webhook_delivery_destination_url($1)', [firstDelivery.id]), /Not authorized/)
    await assert.rejects(db.query('select configure_device_encryption($1,true,true)', [ids.device]), /Not authorized/)

    await asUser(ids.outsider)
    assert.equal(await scalar('select get_org_device_limit($1)', [ids.org]), null)
    assert.equal(await scalar("select org_has_entitlement($1,'team_rbac')", [ids.org]), null)
    await assert.rejects(db.query('select get_device_encryption_key($1)', [ids.device]), /Not authorized/)
    await db.exec('reset role')

    const exposed = await db.query(`
      select p.oid::regprocedure::text as signature
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    `)
    assert.deepEqual(exposed.rows, [])
    const deniedToService = await db.query(`
      select p.oid::regprocedure::text as signature
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and not has_function_privilege('service_role', p.oid, 'EXECUTE')
    `)
    assert.deepEqual(deniedToService.rows, [])
    await db.exec('set role service_role')
    assert.equal(await scalar('select get_org_device_limit($1)', [ids.org]), 5)
    assert.equal(await scalar("select ingest_device_telemetry($1,$2,now(),$3,'{}',60)", [ids.device, Buffer.alloc(12, 9), Buffer.alloc(32, 9)]), true)
    await db.exec('reset role')

    await asUser(ids.owner)
    const oldEvent = (await db.query("insert into telemetry(device_id,parsed_json,timestamp) values($1,'{\"temperature\":42}',now()-interval '40 days') returning id", [ids.device])).rows[0]
    const delivery = (await db.query('select id from webhook_deliveries where event_id=$1', [oldEvent.id])).rows[0]
    await db.query("update webhook_deliveries set created_at=now()-interval '40 days' where id=$1", [delivery.id])
    await db.query("insert into webhook_attempts(delivery_id,outcome) values($1,'retry')", [delivery.id])
    await db.query("insert into device_replay_nonces(device_id,nonce,frame_timestamp,expires_at) values($1,$2,now()-interval '2 hours',now()-interval '2 hours')", [ids.device, Buffer.alloc(12, 3)])
    await db.query("insert into device_event_ids(device_id,event_id,digest) values($1,$2,$3)", [ids.device, Buffer.alloc(16, 4), Buffer.alloc(32, 5)])
    assert.equal(await scalar('select purge_expired_telemetry()'), 1)
    assert.equal(await scalar('select count(*)::integer from webhook_deliveries where id=$1', [delivery.id]), 0)
    assert.equal(await scalar('select count(*)::integer from webhook_attempts where delivery_id=$1', [delivery.id]), 0)
    assert.equal(await scalar("select count(*)::integer from device_replay_nonces where expires_at < now()-interval '1 hour'"), 0)
    assert.equal(await scalar('select count(*)::integer from device_replay_nonces'), 1)
    assert.equal(await scalar('select count(*)::integer from device_event_ids'), 1)
    console.log('authorization: billing/membership/telemetry writes, secret isolation, audit redaction, RPC access, retention passed')
  } finally {
    await db.close()
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
