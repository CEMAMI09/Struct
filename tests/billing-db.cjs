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

    const bulkImport = '30000000-0000-0000-0000-000000000008'
    const profileImport = '30000000-0000-0000-0000-000000000009'
    const createImport = async (id, hash, quotedDevices, currentCount) => db.query(`
      insert into bulk_device_imports (
        id, organization_id, user_id, payload_hash, devices, status,
        current_device_count, projected_device_count, previous_stripe_quantity,
        target_stripe_quantity, stripe_idempotency_key, expires_at
      ) values ($1,$2,$3,$4,$5,'processing',$6,$7,0,0,$8,now()+interval '10 minutes')
    `, [id, deviceOrg, deviceUser, hash, JSON.stringify(quotedDevices), currentCount,
      currentCount + quotedDevices.length, `test:${id}`])
    const finalized = async (id, profileId, payload, currentCount) => db.query(
      'select id,key_id from finalize_bulk_device_import($1,$2,$3,$4,$5,$6)',
      [id, deviceOrg, deviceUser, profileId, JSON.stringify(payload), currentCount],
    )
    const receipt = async (id) => (await db.query(
      'select status,created_device_ids from bulk_device_imports where id=$1', [id],
    )).rows[0]

    const atomicBulk = [{ name: 'Atomic bulk', mac_address: '001122334470', key_id: 'atomic-bulk-key', api_secret_encrypted: 'ciphertext' }]
    await createImport(bulkImport, 'bulk-hash', atomicBulk, 3)
    await db.exec('reset role')
    await db.exec("create function fail_import_completion_test() returns trigger language plpgsql as $$ begin if new.status = 'completed' then raise exception 'receipt storage outage'; end if; return new; end $$; create trigger fail_import_completion_test before update on bulk_device_imports for each row execute function fail_import_completion_test();")
    await db.exec('set role service_role')
    await assert.rejects(finalized(bulkImport, null, atomicBulk, 3), /receipt storage outage/)
    assert.equal((await db.query('select count(*)::integer from devices where organization_id=$1', [deviceOrg])).rows[0].count, 3,
      'failed receipt update rolls back devices')
    assert.equal(await peakCount(), 3, 'failed receipt update rolls back usage peak')
    assert.deepEqual(await receipt(bulkImport), { status: 'processing', created_device_ids: [] })
    await db.exec('reset role')
    await db.exec('drop trigger fail_import_completion_test on bulk_device_imports')
    await db.exec('set role service_role')

    const bulkCreated = (await finalized(bulkImport, null, atomicBulk, 3)).rows
    assert.equal(bulkCreated.length, 1)
    assert.deepEqual(await receipt(bulkImport), { status: 'completed', created_device_ids: [bulkCreated[0].id] },
      'device insert and recoverable receipt commit together')
    await assert.rejects(finalized(bulkImport, null, atomicBulk, 3), /IMPORT_NOT_PROCESSING/)
    assert.equal((await db.query('select count(*)::integer from devices where organization_id=$1', [deviceOrg])).rows[0].count, 4,
      'retry cannot duplicate devices')

    const atomicProfile = [{ name: 'Atomic profile', hardware_id: 'unit-2', key_id: 'atomic-profile-key', api_secret_encrypted: 'ciphertext' }]
    await createImport(profileImport, `profile:${profile}:hash`, atomicProfile, 4)
    await assert.rejects(finalized(profileImport, null, atomicProfile, 4), /IMPORT_PROFILE_MISMATCH/)
    const profileCreated = (await finalized(profileImport, profile, atomicProfile, 4)).rows
    assert.equal(profileCreated.length, 1)
    assert.deepEqual(await receipt(profileImport), { status: 'completed', created_device_ids: [profileCreated[0].id] })
    assert.equal(await peakCount(), 5)
    await db.exec('reset role')

    const checkoutToken1 = '30000000-0000-0000-0000-00000000000a'
    const checkoutToken2 = '30000000-0000-0000-0000-00000000000b'
    const checkoutClaim = async (token) => (await db.query(
      'select claim_org_checkout_session($1,$2) as result', [deviceOrg, token],
    )).rows[0].result
    await db.exec('set role service_role')
    assert.deepEqual(await checkoutClaim(checkoutToken1), { status: 'claimed', claimToken: checkoutToken1 })
    assert.deepEqual(await checkoutClaim(checkoutToken2), { status: 'busy' },
      'concurrent checkout cannot create a second paid session')
    await db.query("update organization_checkout_claims set claim_expires_at=now()-interval '1 second' where organization_id=$1", [deviceOrg])
    assert.deepEqual(await checkoutClaim(checkoutToken2), { status: 'claimed', claimToken: checkoutToken1 },
      'retry after timeout must reuse Stripe idempotency key')
    assert.equal((await db.query(
      "select complete_org_checkout_session($1,$2,'cs_test',now()+interval '30 minutes') as recorded",
      [deviceOrg, checkoutToken1],
    )).rows[0].recorded, true)
    assert.deepEqual(await checkoutClaim(checkoutToken2), { status: 'session', sessionId: 'cs_test' })
    assert.equal((await db.query(
      "select release_org_checkout_session($1,'cs_wrong') as released", [deviceOrg],
    )).rows[0].released, false)
    assert.equal((await db.query(
      "select release_org_checkout_session($1,'cs_test') as released", [deviceOrg],
    )).rows[0].released, true)
    assert.deepEqual(await checkoutClaim(checkoutToken2), { status: 'claimed', claimToken: checkoutToken2 })
    assert.equal((await db.query(
      'select release_org_checkout_claim($1,$2) as released', [deviceOrg, checkoutToken2],
    )).rows[0].released, true)
    await db.query("update organizations set stripe_subscription_id='sub_paid' where id=$1", [deviceOrg])
    assert.deepEqual(await checkoutClaim(checkoutToken2), { status: 'subscribed' })
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
        'finalize_bulk_device_import(uuid,uuid,uuid,uuid,jsonb,integer)',
        'claim_org_checkout_session(uuid,uuid)',
        'complete_org_checkout_session(uuid,uuid,text,timestamptz)',
        'release_org_checkout_session(uuid,text)',
        'release_org_checkout_claim(uuid,uuid)',
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
