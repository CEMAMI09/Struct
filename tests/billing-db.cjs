const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createDatabase } = require('./database.cjs')

async function testMigrationUpgrade() {
  const db = await createDatabase('026')
  try {
    const org = '30000000-0000-0000-0000-000000000008'
    const current = '30000000-0000-0000-0000-000000000009'
    const historical = '30000000-0000-0000-0000-000000000010'
    await db.query("insert into organizations(id,name,subscription_tier,stripe_quantity,stripe_subscription_id) values($1,'Existing','pro',170,'sub_existing')", [org])
    await db.query(`
      insert into organization_device_usage_periods
        (id,organization_id,stripe_period_start,stripe_period_end,tier,
         included_paid_quantity,peak_paid_quantity)
      values
        ($1,$3,date_trunc('month',now()),date_trunc('month',now())+interval '1 month','pro',150,160),
        ($2,$3,date_trunc('month',now())-interval '1 month',date_trunc('month',now()),'pro',150,160)
    `, [current, historical, org])

    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/027_billing_true_up_claim.sql'), 'utf8')
    await db.exec(migration)
    const currentRow = (await db.query('select included_paid_quantity,peak_paid_quantity,true_up_baseline_verified from organization_device_usage_periods where id=$1', [current])).rows[0]
    assert.deepEqual(currentRow, {
      included_paid_quantity: 170, peak_paid_quantity: 170,
      true_up_baseline_verified: false,
    }, 'current open period is backfilled but still requires reconciliation')
    const oldRow = (await db.query('select included_paid_quantity,true_up_baseline_verified from organization_device_usage_periods where id=$1', [historical])).rows[0]
    assert.deepEqual(oldRow, { included_paid_quantity: 150, true_up_baseline_verified: false })
    await db.exec('set role service_role')
    await assert.rejects(
      db.query('select claim_org_usage_true_up($1,$2)', [historical, '30000000-0000-0000-0000-000000000011']),
      /USAGE_BASELINE_RECONCILIATION_REQUIRED/,
    )
    await db.exec('reset role')
  } finally {
    await db.close()
  }
}

async function run() {
  await testMigrationUpgrade()
  const db = await createDatabase()
  try {
    const org = '30000000-0000-0000-0000-000000000001'
    const period = '30000000-0000-0000-0000-000000000002'
    const firstClaim = '30000000-0000-0000-0000-000000000003'
    const secondClaim = '30000000-0000-0000-0000-000000000004'
    await db.query("insert into organizations(id,name) values($1,'Billing test')", [org])
    await db.query(`
      insert into organization_device_usage_periods
        (id, organization_id, stripe_period_start, stripe_period_end, tier,
         included_paid_quantity, peak_paid_quantity)
      values ($1,$2,now()-interval '2 months',now()-interval '1 month','pro',150,160)
    `, [period, org])

    const claim = async (token) => (await db.query(
      'select (claim_org_usage_true_up($1,$2)).id as id', [period, token],
    )).rows[0].id
    assert.equal(await claim(firstClaim), period)
    assert.equal(await claim(secondClaim), null, 'concurrent claim must fail')

    await db.query("update organization_device_usage_periods set true_up_claim_expires_at=now()-interval '1 second' where id=$1", [period])
    assert.equal(await claim(secondClaim), period, 'expired claim is recoverable')
    assert.equal((await db.query('select release_org_usage_true_up($1,$2) as released', [period, firstClaim])).rows[0].released, false)
    assert.equal((await db.query("select (complete_org_usage_true_up($1,$2,'ii_test',500,'invoiced')).status as status", [period, secondClaim])).rows[0].status, 'invoiced')
    assert.equal(await claim(firstClaim), null, 'completed period cannot be billed twice')

    // A calendar row can start on free, then gain paid capacity through a
    // Stripe update. Its baseline must include that already-billed quantity.
    await db.exec('set role service_role')
    await db.query('select record_org_device_peak($1,5)', [org])
    const currentPeriod = async () => (await db.query(`
      select tier, included_paid_quantity, peak_device_count, peak_paid_quantity
      from organization_device_usage_periods
      where organization_id=$1 and stripe_period_start=date_trunc('month',now())
    `, [org])).rows[0]
    assert.deepEqual(await currentPeriod(), {
      tier: 'free', included_paid_quantity: 0,
      peak_device_count: 5, peak_paid_quantity: 0,
    })

    await db.query("update organizations set subscription_tier='pro', stripe_quantity=170, stripe_subscription_id='sub_test' where id=$1", [org])
    assert.deepEqual(await currentPeriod(), {
      tier: 'pro', included_paid_quantity: 170,
      peak_device_count: 5, peak_paid_quantity: 170,
    }, 'Stripe quantity updates must refresh an existing open period')
    await db.query('select record_org_device_peak($1,180)', [org])
    assert.equal((await currentPeriod()).peak_paid_quantity, 175)

    await db.query('update organizations set stripe_quantity=190 where id=$1', [org])
    assert.equal((await currentPeriod()).included_paid_quantity, 190)
    await db.query("update organizations set subscription_tier='flexible', stripe_quantity=5 where id=$1", [org])
    await db.query('select record_org_device_peak($1,185)', [org])
    assert.deepEqual(await currentPeriod(), {
      tier: 'pro', included_paid_quantity: 190,
      peak_device_count: 185, peak_paid_quantity: 190,
    }, 'later peaks must not lower a paid period snapshot')
    await db.query("update organizations set subscription_tier='scale', stripe_quantity=1000 where id=$1", [org])
    assert.equal((await currentPeriod()).tier, 'scale')
    assert.equal((await currentPeriod()).included_paid_quantity, 1000)
    const closed = (await db.query('select tier,included_paid_quantity,status from organization_device_usage_periods where id=$1', [period])).rows[0]
    assert.deepEqual(closed, { tier: 'pro', included_paid_quantity: 150, status: 'invoiced' }, 'closed periods remain fixed')
    await db.exec('reset role')

    const deviceOrg = '30000000-0000-0000-0000-000000000005'
    const deviceUser = '30000000-0000-0000-0000-000000000006'
    await db.query("insert into auth.users(id,email) values($1,'device-owner@example.invalid')", [deviceUser])
    await db.query("insert into organizations(id,name) values($1,'Atomic devices')", [deviceOrg])
    const createDevice = async (key, expectedCount) => db.query(
      'select (create_device_with_usage($1,$2,$3,$4,$5,$6,$7,$8)).id as id',
      [deviceOrg, deviceUser, 'Sensor', key, 'ciphertext', 'abcd', null, expectedCount],
    )
    const peakCount = async () => (await db.query(
      "select peak_device_count from organization_device_usage_periods where organization_id=$1 and stripe_period_start=date_trunc('month',now())",
      [deviceOrg],
    )).rows[0]?.peak_device_count

    await db.exec('set role service_role')
    const createdId = (await createDevice('single-key', 0)).rows[0].id
    assert.equal((await db.query('select count(*)::integer from schemas where device_id=$1', [createdId])).rows[0].count, 1)
    assert.equal((await db.query('select count(*)::integer from schema_versions where device_id=$1', [createdId])).rows[0].count, 1)
    assert.equal(await peakCount(), 1, 'device insert records peak in its transaction')
    await assert.rejects(createDevice('stale-key', 0), /DEVICE_COUNT_CHANGED/)
    await db.exec('reset role')

    await db.exec("create function fail_schema_test() returns trigger language plpgsql as $$ begin raise exception 'test schema outage'; end $$; create trigger fail_schema_test before insert on schemas for each row execute function fail_schema_test();")
    await db.exec('set role service_role')
    await assert.rejects(createDevice('failed-key', 1), /test schema outage/)
    assert.equal((await db.query('select count(*)::integer from devices where organization_id=$1', [deviceOrg])).rows[0].count, 1)
    assert.equal(await peakCount(), 1, 'failed schema insert rolls back device and usage')
    await db.exec('reset role')
    await db.exec('drop trigger fail_schema_test on schemas')

    await db.exec('set role service_role')
    const bulkRows = [{ name: 'Bulk', mac_address: '001122334455', key_id: 'bulk-key', api_secret_encrypted: 'ciphertext' }]
    assert.equal((await db.query('select id from bulk_insert_devices($1,$2,$3,$4)', [deviceOrg, deviceUser, JSON.stringify(bulkRows), 1])).rows.length, 1)
    assert.equal(await peakCount(), 2, 'bulk insert records the final device count atomically')
    const profile = '30000000-0000-0000-0000-000000000007'
    await db.query("insert into device_profiles(id,organization_id,user_id,name,fleet_key_id,fleet_secret_encrypted) values($1,$2,$3,'Profile','fedcba9876543210','ciphertext')", [profile, deviceOrg, deviceUser])
    const profileRows = [{ name: 'Profile unit', hardware_id: 'unit-1', key_id: 'profile-key', api_secret_encrypted: 'ciphertext' }]
    assert.equal((await db.query('select id from bulk_provision_profile_devices($1,$2,$3,$4,$5)', [deviceOrg, deviceUser, profile, JSON.stringify(profileRows), 2])).rows.length, 1)
    assert.equal(await peakCount(), 3, 'profile provisioning records usage inside its insert transaction')
    const excessRows = [0, 1, 2].map(i => ({
      name: `Excess ${i}`, mac_address: `00112233446${i}`,
      key_id: `excess-key-${i}`, api_secret_encrypted: 'ciphertext',
    }))
    await assert.rejects(
      db.query('select id from bulk_insert_devices($1,$2,$3,$4)', [deviceOrg, deviceUser, JSON.stringify(excessRows), 3]),
      /FREE_DEVICE_LIMIT_EXCEEDED/,
    )
    assert.equal((await db.query('select count(*)::integer from devices where organization_id=$1', [deviceOrg])).rows[0].count, 3)
    assert.equal(await peakCount(), 3, 'free capacity failure rolls back the entire bulk insert')
    await db.exec('reset role')

    for (const role of ['anon', 'authenticated']) {
      for (const signature of [
        'record_org_device_peak(uuid,integer)',
        'record_inserted_device_usage()',
        'create_device_with_usage(uuid,uuid,text,text,text,text,text,integer)',
        'refresh_org_usage_paid_baseline()',
        'claim_org_usage_true_up(uuid,uuid)',
        'complete_org_usage_true_up(uuid,uuid,text,integer,public.usage_period_status)',
        'release_org_usage_true_up(uuid,uuid)',
      ]) {
        const allowed = (await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, `public.${signature}`])).rows[0].allowed
        assert.equal(allowed, false, `${role} can execute ${signature}`)
      }
    }
    console.log('billing db: paid baseline, atomic device usage, free cap, claim lease, and role restrictions passed')
  } finally {
    await db.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
