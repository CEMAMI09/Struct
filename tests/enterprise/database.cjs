const assert = require('node:assert/strict'),
  { randomUUID, randomBytes, createHash } = require('node:crypto'),
  { setup } = require('../observability/fixture.cjs')
async function run() {
  const f = await setup(),
    { db, scalar } = f
  let checks = 0
  const check = (v, m) => {
    assert(v, m)
    checks++
  }
  const reject = async (p, re) => {
    await assert.rejects(p, re)
    checks++
  }
  try {
    await db.exec(
      'update enterprise_settings set enabled=true;alter table auth.users add column email_confirmed_at timestamptz',
    )
    await db.query(
      "update organizations set subscription_tier='scale',stripe_quantity=10000 where id=$1",
      [f.org],
    )
    await db.query(
      'update auth.users set email_confirmed_at=now() where id=$1',
      [f.user],
    )
    const members = {}
    for (const role of ['admin', 'developer', 'operator', 'viewer']) {
      const id = randomUUID()
      await db.query(
        'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
        [id, role + '@example.invalid'],
      )
      const m = await scalar(
        'insert into organization_members(organization_id,user_id,role) values($1,$2,$3) returning id',
        [f.org, id, role],
      )
      members[role] = { id, member: m }
    }
    const command = (actor, action, data) =>
      scalar('select enterprise_team_command($1,$2,$3,$4)', [
        f.org,
        actor,
        action,
        JSON.stringify(data),
      ])
    for (const [role, caps] of Object.entries(
      require('../../protocol/enterprise-permissions.json'),
    )) {
      const actual = await scalar(
        'select array_agg(capability order by capability) from role_permissions where role=$1',
        [role],
      )
      check(
        JSON.stringify(actual) === JSON.stringify([...caps].sort()),
        role + ' matrix matches canonical catalog',
      )
    }
    check(
      await scalar("select org_has_permission($1,$2,'devices.create')", [
        f.org,
        members.developer.id,
      ]),
      'developer can create',
    )
    check(
      !(await scalar("select org_has_permission($1,$2,'billing.manage')", [
        f.org,
        members.developer.id,
      ])),
      'developer cannot bill',
    )
    check(
      !(await scalar("select org_has_permission($1,$2,'devices.provision')", [
        f.org,
        members.operator.id,
      ])),
      'operator cannot read roots',
    )
    check(
      await scalar("select org_has_permission($1,$2,'delivery.retry')", [
        f.org,
        members.operator.id,
      ]),
      'operator retry classified',
    )
    await reject(
      command(members.admin.id, 'role', {
        member: members.viewer.member,
        role: 'admin',
      }),
      /PERMISSION_DENIED/,
    )
    await reject(
      command(members.viewer.id, 'rename', { name: 'unauthorized' }),
      /PERMISSION_DENIED/,
    )
    await reject(
      command(f.user, 'remove', {
        member: await scalar(
          'select id from organization_members where organization_id=$1 and user_id=$2',
          [f.org, f.user],
        ),
      }),
      /LAST_OWNER/,
    )
    await reject(command(f.user,'invite',{id:randomUUID(),email:'viewer@example.invalid',role:'operator',hash:'00'.repeat(32)}),/ALREADY_MEMBER/)
    const invited = randomUUID(),
      token = randomBytes(32),
      hash = createHash('sha256').update(token).digest('hex'),
      invite = randomUUID()
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [invited, 'new@example.invalid'],
    )
    await command(members.admin.id, 'invite', {
      id: invite,
      email: 'NEW@example.invalid',
      role: 'developer',
      hash,
    })
    check(
      (await scalar(
        'select count(*)::int from organization_members where user_id=$1',
        [invited],
      )) === 0,
      'invitation never adds member before acceptance',
    )
    await reject(
      scalar('select enterprise_accept_invitation($1,$2,$3)', [
        members.viewer.id,
        invite,
        Buffer.from(hash, 'hex'),
      ]),
      /INVITATION_UNAVAILABLE/,
    )
    await reject(
      scalar('select enterprise_accept_invitation($1,$2,$3)', [
        invited,
        invite,
        Buffer.alloc(32),
      ]),
      /INVITATION_UNAVAILABLE/,
    )
    await db.query('update auth.users set email_confirmed_at=null where id=$1',[invited])
    await reject(scalar('select enterprise_accept_invitation($1,$2,$3)',[invited,invite,Buffer.from(hash,'hex')]),/INVITATION_UNAVAILABLE/)
    await db.query('update auth.users set email_confirmed_at=now() where id=$1',[invited])
    check(
      (await scalar('select enterprise_accept_invitation($1,$2,$3)', [
        invited,
        invite,
        Buffer.from(hash, 'hex'),
      ])) === f.org,
      'verified recipient accepts atomically',
    )
    await reject(
      scalar('select enterprise_accept_invitation($1,$2,$3)', [
        invited,
        invite,
        Buffer.from(hash, 'hex'),
      ]),
      /INVITATION_UNAVAILABLE/,
    )
    const exp = randomUUID()
    await command(f.user, 'invite', {
      id: exp,
      email: 'expired@example.invalid',
      role: 'viewer',
      hash,
    })
    await db.query(
      "update organization_invitations set expires_at=now()-interval '1 second' where id=$1",
      [exp],
    )
    await reject(
      scalar('select enterprise_accept_invitation($1,$2,$3)', [
        invited,
        exp,
        Buffer.from(hash, 'hex'),
      ]),
      /INVITATION_UNAVAILABLE/,
    )
    const resent = randomUUID()
    await command(f.user, 'invite', {
      id: resent,
      email: 'resend@example.invalid',
      role: 'viewer',
      hash,
    })
    const h2 = randomBytes(32).toString('hex')
    await command(f.user, 'resend', { id: resent, hash: h2 })
    check(
      (await scalar(
        "select encode(token_hash,'hex') from organization_invitations where id=$1",
        [resent],
      )) === h2,
      'resend invalidates old token',
    )
    await command(f.user, 'revoke_invite', { id: resent })
    check(
      await scalar(
        'select revoked_at is not null from organization_invitations where id=$1',
        [resent],
      ),
      'invitation revoked',
    )
    const key = randomUUID(),
      keyHash = randomBytes(32).toString('hex')
    const keyCmd = (actor, action, data) =>
      scalar('select enterprise_key_command($1,$2,$3,$4)', [
        f.org,
        actor,
        action,
        JSON.stringify(data),
      ])
    await keyCmd(members.admin.id, 'create', {
      id: key,
      name: 'inventory',
      hash: keyHash,
      scopes: ['devices.read'],
      days: 7,
    })
    const verify = (cap, h = keyHash) =>
      scalar('select enterprise_verify_key($1,$2,$3)', [
        key,
        Buffer.from(h, 'hex'),
        cap,
      ])
    check(
      (await verify('devices.read')).organization_id === f.org,
      'management key verifies hashed material',
    )
    await reject(verify('devices.create'), /INVALID_MANAGEMENT_KEY/)
    await reject(
      verify('devices.read', '00'.repeat(32)),
      /INVALID_MANAGEMENT_KEY/,
    )
    await reject(
      keyCmd(members.viewer.id, 'create', {
        id: randomUUID(),
        name: 'bad',
        hash: keyHash,
        scopes: ['devices.read'],
        days: 7,
      }),
      /PERMISSION_DENIED/,
    )
    await reject(
      keyCmd(f.user, 'create', {
        id: randomUUID(),
        name: 'bad scope',
        hash: keyHash,
        scopes: ['devices.export_credentials'],
        days: 7,
      }),
      /UNSUPPORTED_SCOPE/,
    )
    const replacement = randomBytes(32).toString('hex')
    await keyCmd(f.user, 'rotate', { id: key, hash: replacement })
    await reject(verify('devices.read'), /INVALID_MANAGEMENT_KEY/)
    check(
      (await verify('devices.read', replacement)).organization_id === f.org,
      'rotated key accepted',
    )
    await command(f.user, 'remove', { member: members.admin.member })
    await reject(verify('devices.read', replacement), /INVALID_MANAGEMENT_KEY/)
    check(
      (await scalar('select count(*)::int from devices where id=$1', [
        f.device,
      ])) === 1,
      'member removal preserves device',
    )
    check(
      (await scalar(
        "select count(*)::int from audit_logs where event_action='team.join'",
      )) === 1,
      'joined audit durable',
    )
    const history = await scalar('select enterprise_audit_search($1,$2)', [
      f.org,
      f.user,
    ])
    check(
      history.length > 0 &&
        !JSON.stringify(history).includes(hash) &&
        !JSON.stringify(history).includes('root_secret_encrypted'),
      'audit safe projection',
    )
    await reject(
      scalar('select enterprise_audit_search($1,$2)', [
        f.org,
        members.viewer.id,
      ]),
      /PERMISSION_DENIED/,
    )
    await db.exec('set role authenticated')
    await reject(
      db.exec("update audit_logs set outcome='failed'"),
      /permission denied|append-only/,
    )
    await reject(
      db.exec('select token_hash from enterprise_api_keys'),
      /permission denied/,
    )
    await reject(
      db.exec('select token_hash from organization_invitations'),
      /permission denied/,
    )
    await reject(
      db.exec('select enterprise_overview(null,null)'),
      /permission denied/,
    )
    await db.exec('reset role')
    const prior = await scalar('select count(*)::int from audit_logs')
    await f.ingest(0)
    await f.ingest(1)
    const after = await scalar('select count(*)::int from audit_logs')
    check(
      after - prior <= 2,
      'continuous commits do not flood administrative audit',
    )
    check(
      (await scalar('select count(*)::int from telemetry where device_id=$1', [
        f.device,
      ])) === 2,
      'existing Secure V2 ingestion survives membership changes',
    )
    const oldAudit=randomUUID()
    await db.query("insert into audit_logs(id,organization_id,user_id,action,table_name,record_id,created_at) values($1,$2,$3,'UPDATE','fixture',$2,now()-interval '91 days')",[oldAudit,f.org,f.user])
    check((await scalar('select enterprise_cleanup()'))===1,'bounded audit retention removes genuinely expired evidence')
    check((await scalar("select count(*)::int from audit_logs where organization_id=$1 and event_action='audit.retention'",[f.org]))===1,'retention itself leaves safe organization audit evidence')
    check((await scalar("select count(*)::int from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'enterprise_%' and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))"))===0,'every enterprise service function rejects direct untrusted execution')
    console.log(
      'PASS ' +
        checks +
        ' enterprise permissions/invitations/keys/audit/ingestion checks',
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
