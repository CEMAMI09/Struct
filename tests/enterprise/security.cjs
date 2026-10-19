const assert = require('node:assert/strict'),
  { randomUUID, randomBytes } = require('node:crypto'),
  { setup } = require('../observability/fixture.cjs'),
  { credentials } = require('../../tcp-server/fleet/worker')
async function run() {
  process.env.STRUCT_OBSERVABILITY_ENABLED = 'true'
  const f = await setup(),
    { db, scalar } = f
  let n = 0
  const check = (v, m) => {
      assert(v, m)
      n++
    },
    reject = async (p, re) => {
      await assert.rejects(p, re)
      n++
    }
  try {
    await db.exec(
      'update enterprise_settings set enabled=true;update fleet_settings set enabled=true;update delivery_pipeline_settings set enabled=true;update integration_settings set enabled=true',
    )
    await db.query(
      "update organizations set subscription_tier='scale',stripe_quantity=1000 where id=$1",
      [f.org],
    )
    const roles = {}
    for (const role of ['developer', 'operator', 'viewer']) {
      const id = randomUUID()
      await db.query('insert into auth.users(id,email) values($1,$2)', [
        id,
        role + '@security.example.invalid',
      ])
      await db.query(
        'insert into organization_members(organization_id,user_id,role) values($1,$2,$3)',
        [f.org, id, role],
      )
      roles[role] = id
    }
    await db.query("select set_config('request.jwt.claim.sub','',false)")
    const c = credentials(),
      created = await scalar(
        'select row_to_json(create_secure_device_with_usage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12))',
        [
          f.org,
          roles.developer,
          'Developer sensor',
          c.key_id,
          c.api_encrypted,
          c.api_preview,
          '',
          1,
          c.root_encrypted,
          c.root_preview,
          c.bootstrap_encrypted,
          Buffer.from(c.bootstrap_hash, 'hex'),
        ],
      )
    check(
      created.organization_id === f.org,
      'developer actually creates securely enrolled device',
    )
    check(
      (await scalar(
        'select user_id from audit_logs where record_id=$1 order by created_at desc limit 1',
        [created.id],
      )) === roles.developer,
      'service mutation has verified initiating actor',
    )
    const secret = await scalar('select enterprise_sensitive_read($1,$2,$3)', [
      f.org,
      roles.developer,
      created.id,
    ])
    check(secret.wire_device_id, 'developer individual SDK provisioning works')
    await reject(
      scalar('select enterprise_sensitive_read($1,$2,$3)', [
        f.org,
        roles.operator,
        created.id,
      ]),
      /PERMISSION_DENIED/,
    )
    await reject(
      scalar('select fleet_manifest($1,$2,$3,$4)', [
        f.org,
        roles.developer,
        randomUUID(),
        [created.id],
      ]),
      /FORBIDDEN/,
    )
    for (const operation of ['reprovision', 'revoke', 'delete']) {
      await reject(scalar('select fleet_preview($1,$2,$3,$4,$5)', [f.org, roles.developer, randomUUID(), operation, JSON.stringify({ids:[created.id]})]), /FORBIDDEN/)
    }
    await reject(
      scalar('select save_integration($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
        f.org,
        roles.developer,
        randomUUID(),
        'Unauthorized credentials',
        'http',
        '{}',
        null,
        '{}',
        'encrypted',
        0,
        false,
      ]),
      /Not authorized/,
    )
    const legacy=await scalar("select enterprise_legacy_admin($1,$2,'legacy_key',$3,$4)",[f.org,roles.developer,created.id,JSON.stringify({key_id:c.key_id,secret_encrypted:c.api_encrypted,secret_preview:c.api_preview})])
    check(legacy.key_id===c.key_id,'legacy individual credential change is transactionally authorized')
    await reject(scalar("select enterprise_legacy_admin($1,$2,'profile',null,$3)",[f.org,roles.developer,'{}']),/PERMISSION_DENIED/)
    const profile=await scalar("select enterprise_legacy_admin($1,$2,'profile',null,$3)",[f.org,f.user,JSON.stringify({name:'Authorized legacy profile',device_model:'Fixture',firmware_version:'test',schema_definition:[{name:'device_id',type:'uint32'}],identity_field:'device_id',key_id:c.key_id,secret_encrypted:c.api_encrypted,secret_preview:c.api_preview})])
    check(profile.organization_id===f.org,'legacy profile creation has audited live principal')
    await f.ingest(0)
    await reject(scalar("select enterprise_legacy_admin($1,$2,'delete',$3)",[f.org,f.user,f.device]),/USE_FLEET_ARCHIVE/)
    const delivery = await scalar('select id from webhook_deliveries limit 1')
    await db.query(
      "update webhook_deliveries set status='dead',terminal_reason='test' where id=$1",
      [delivery],
    )
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      roles.operator,
    ])
    await db.exec('set role authenticated')
    const retried = await scalar(
      "select delivery_recovery($1,$2,'retry',$3,true)",
      [f.org, [delivery], randomUUID()],
    )
    check(retried.scheduled === 1, 'operator actually retries failed delivery')
    await reject(
      scalar("select delivery_recovery($1,$2,'replay',$3,true)", [
        f.org,
        [delivery],
        randomUUID(),
      ]),
      /PERMISSION_DENIED/,
    )
    await reject(
      scalar('select get_destination_signing_secret($1)', [f.destination]),
      /Not authorized/,
    )
    await reject(
      db.exec('select root_secret_encrypted from secure_v2_credentials'),
      /permission denied/,
    )
    await db.exec('reset role')
    const rule = await f.command('rule', {
      name: 'Operator acknowledgment',
      kind: 'bytes',
      threshold: 1,
      clear: 0,
      enabled: true,
    })
    await scalar('select aggregate_metric_events(100)')
    await scalar('select evaluate_alert_rule($1)', [rule.id])
    const incident = await scalar(
      'select id from alert_incidents where rule_id=$1',
      [rule.id],
    )
    await scalar("select observability_command($1,$2,'acknowledge',$3)", [
      f.org,
      roles.operator,
      JSON.stringify({ id: incident }),
    ])
    check(
      (await scalar('select status from alert_incidents where id=$1', [
        incident,
      ])) === 'acknowledged',
      'operator actually acknowledges incident',
    )
    await reject(
      scalar("select observability_command($1,$2,'resolve',$3)", [
        f.org,
        roles.operator,
        JSON.stringify({ id: incident }),
      ]),
      /FORBIDDEN/,
    )
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      roles.developer,
    ])
    await db.exec('set role authenticated')
    check(
      (
        await db.query(
          'update organizations set name=$1 where id=$2 returning id',
          ['Forbidden rename', f.org],
        )
      ).rows.length === 0,
      'developer cannot rename organization directly',
    )
    await reject(
      db.query('update organizations set stripe_quantity=9999 where id=$1', [
        f.org,
      ]),
      /permission denied/,
    )
    await reject(
      db.query(
        "update organization_members set role='owner' where user_id=$1",
        [roles.developer],
      ),
      /permission denied/,
    )
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      f.user,
    ])
    const member = await scalar(
      'select id from organization_members where organization_id=$1 and user_id=$2',
      [f.org, roles.developer],
    )
    await scalar("select enterprise_team_command($1,$2,'remove',$3)", [
      f.org,
      f.user,
      JSON.stringify({ member }),
    ])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      roles.developer,
    ])
    await db.exec('set role authenticated')
    check(
      (await db.query('select id from devices where id=$1', [created.id])).rows
        .length === 0,
      'removed creator has no fallback user_id access',
    )
    await db.exec('reset role')
    check(
      (await scalar('select count(*)::int from devices where id=$1', [
        created.id,
      ])) === 1,
      'removed creator resource persists',
    )
    await reject(
      db.query('delete from auth.users where id=$1', [f.user]),
      /REASSIGNMENT/,
    )
    await reject(
      db.exec("update audit_logs set outcome='failed'"),
      /append-only/,
    )
    const other = randomUUID()
    await db.query(
      "insert into organizations(id,name) values($1,'Other tenant')",
      [other],
    )
    await reject(
      scalar('select enterprise_overview($1,$2)', [other, f.user]),
      /PERMISSION_DENIED/,
    )
    await reject(
      scalar('select enterprise_operations($1,$2)', [f.org, roles.viewer]),
      /PERMISSION_DENIED/,
    )
    console.log(
      'PASS ' +
        n +
        ' actual enterprise authorization/credential/recovery/RLS checks',
    )
  } finally {
    await db.exec('reset role')
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
