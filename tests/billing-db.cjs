const assert = require('node:assert/strict')
const { createDatabase } = require('./database.cjs')

async function run() {
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

    for (const role of ['anon', 'authenticated']) {
      for (const signature of [
        'claim_org_usage_true_up(uuid,uuid)',
        'complete_org_usage_true_up(uuid,uuid,text,integer,public.usage_period_status)',
        'release_org_usage_true_up(uuid,uuid)',
      ]) {
        const allowed = (await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, `public.${signature}`])).rows[0].allowed
        assert.equal(allowed, false, `${role} can execute ${signature}`)
      }
    }
    console.log('billing db: claim lease, recovery, completion, and role restrictions passed')
  } finally {
    await db.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
