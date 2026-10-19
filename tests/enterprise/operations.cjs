const assert = require('node:assert/strict'),
  { randomUUID, randomBytes, createHash } = require('node:crypto'),
  { setup } = require('../observability/fixture.cjs'),
  { encryptSecret } = require('../../tcp-server/auth'),
  { tick } = require('../../tcp-server/enterprise/worker'),
  { sendEmail } = require('../../tcp-server/observability/worker'),
  { credentials } = require('../../tcp-server/fleet/worker')
async function run() {
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
  const saved = {
    key: process.env.RESEND_API_KEY,
    from: process.env.STRUCT_ALERT_EMAIL_FROM,
    origin: process.env.STRUCT_APP_URL,
  }
  try {
    await db.exec(
      'update enterprise_settings set enabled=true;update fleet_settings set enabled=true',
    )
    await db.query(
      "update organizations set subscription_tier='scale',stripe_quantity=1000 where id=$1",
      [f.org],
    )
    const adapter = {
      rpc: async (name, args = {}) => {
        try {
          assert(/^enterprise_[a-z_]+$/.test(name))
          const data = await scalar(
            'select ' +
              name +
              '(' +
              Object.keys(args)
                .map((k, i) => k + '=>$' + (i + 1))
                .join(',') +
              ')',
            Object.values(args).map((v) =>
              v && typeof v === 'object' && !Buffer.isBuffer(v)
                ? JSON.stringify(v)
                : v,
            ),
          )
          return { data }
        } catch (e) {
          return { error: { message: e.message } }
        }
      },
    }
    const invitation = randomUUID(),
      secret = randomBytes(32).toString('hex'),
      hash = createHash('sha256')
        .update(Buffer.from(secret, 'hex'))
        .digest('hex')
    await scalar("select enterprise_team_command($1,$2,'invite',$3)", [
      f.org,
      f.user,
      JSON.stringify({
        id: invitation,
        email: 'invited@example.invalid',
        role: 'viewer',
        hash,
        sendEmail: true,
        mail_cipher: encryptSecret(secret),
      }),
    ])
    check(
      (await scalar('select count(*)::int from enterprise_mail_jobs')) === 1,
      'invitation and mail intent commit atomically',
    )
    check(
      !JSON.stringify(
        (await db.query('select * from enterprise_mail_jobs')).rows,
      ).includes(secret),
      'mail token encrypted at rest',
    )
    process.env.RESEND_API_KEY = 'test-only-key'
    process.env.STRUCT_ALERT_EMAIL_FROM = 'Struct <test@example.invalid>'
    process.env.STRUCT_APP_URL = 'https://console.example.invalid'
    let calls = 0,
      stable
    const send = (j) =>
      sendEmail(j, async (url, options) => {
        check(
          url === 'https://api.resend.com/emails' &&
            options.redirect === 'error',
          'fixed bounded email transport',
        )
        const body = JSON.parse(options.body)
        check(
          body.to[0] === 'invited@example.invalid' &&
            body.text.includes('/invite#token=' + invitation + '.' + secret),
          'explicit email has intended recipient and fragment link',
        )
        const k = options.headers['idempotency-key']
        stable ??= k
        check(k === stable, 'provider retry identity stable')
        return new Response('{}', {
          status: ++calls === 1 ? 503 : 200,
          headers: { 'retry-after': '1' },
        })
      })
    await tick(adapter, send)
    check(
      (await scalar('select status from enterprise_mail_jobs')) === 'pending',
      'temporary provider outage schedules retry',
    )
    check(
      (await scalar('select count(*)::int from organization_invitations')) ===
        1,
      'mail failure preserves invitation',
    )
    await db.exec(
      "update enterprise_mail_jobs set available_at=now()-interval '1 second'",
    )
    await tick(adapter, send)
    check(
      (await scalar('select status from enterprise_mail_jobs')) === 'delivered',
      'provider acceptance recorded',
    )
    check(
      await scalar("select token_ciphertext='' from enterprise_mail_jobs"),
      'terminal job erases delivery copy',
    )
    check(
      (await scalar('select count(*)::int from enterprise_mail_attempts')) ===
        2,
      'attempt history preserved',
    )
    const key = randomUUID(),
      keyHash = randomBytes(32)
    await scalar("select enterprise_key_command($1,$2,'create',$3)", [
      f.org,
      f.user,
      JSON.stringify({
        id: key,
        hash: keyHash.toString('hex'),
        name: 'Automation',
        scopes: ['devices.read', 'devices.create'],
        days: 7,
      }),
    ])
    const machine = (action, data = {}) =>
      scalar('select enterprise_machine_request($1,$2,$3,$4)', [
        key,
        keyHash,
        action,
        JSON.stringify(data),
      ])
    const inventory = await machine('inventory', { orgId: randomUUID() })
    check(
      inventory.devices.length === 1 && inventory.devices[0].id === f.device,
      'key determines scope; submitted foreign organization ignored',
    )
    await reject(
      machine('usage', {
        from: new Date().toISOString(),
        to: new Date().toISOString(),
      }),
      /INVALID_MANAGEMENT_KEY/,
    )
    const requestId = randomUUID(),
      preview = await machine('preview_create', {
        quantity: 2,
        prefix: 'Manufacturing-',
        requestId,
      }),
      same = await machine('preview_create', {
        quantity: 2,
        prefix: 'Manufacturing-',
        requestId,
      })
    check(
      preview.jobId === same.jobId,
      'management registration preview idempotent',
    )
    check(
      (await scalar('select count(*)::int from devices')) === 1,
      'preview has no registration side effect',
    )
    await reject(
      machine('confirm_create', { jobId: preview.jobId }),
      /INVALID_CONFIRMATION/,
    )
    await machine('confirm_create', { jobId: preview.jobId, confirm: true })
    await machine('confirm_create', { jobId: preview.jobId, confirm: true })
    check(
      (await scalar('select status from fleet_jobs where id=$1', [
        preview.jobId,
      ])) === 'pending',
      'explicit confirm schedules shared durable fleet job',
    )
    for (let i = 0; i < 2; i++) {
      const claim = await scalar('select fleet_claim()')
      check(!!claim, 'shared worker claims registration')
      await scalar('select fleet_finish($1,$2,$3,$4)', [
        claim.job.id,
        claim.item.item_index,
        claim.item.lease_token,
        JSON.stringify(credentials()),
      ])
    }
    check(
      (await scalar('select count(*)::int from devices')) === 3,
      'management request creates real securely enrolled devices through shared worker',
    )
    check(
      (await machine('job', { jobId: preview.jobId })).status === 'completed',
      'job progress reads durable state',
    )
    const overview = await scalar('select enterprise_overview($1,$2)', [
      f.org,
      f.user,
    ])
    check(
      !JSON.stringify(overview).includes(keyHash.toString('hex')) &&
        !JSON.stringify(overview).includes(secret),
      'ordinary overview never discloses stored key material',
    )
    await db.exec('delete from enterprise_key_usage')
    for (let i = 0; i < 120; i++)
      await scalar("select enterprise_verify_key($1,$2,'devices.read')", [
        key,
        keyHash,
      ])
    await reject(
      scalar("select enterprise_verify_key($1,$2,'devices.read')", [
        key,
        keyHash,
      ]),
      /KEY_RATE_LIMIT/,
    )
    const instance = randomUUID()
    await scalar("select enterprise_heartbeat($1,'gateway',true,$2)", [
      instance,
      JSON.stringify({ errors: 0, root_secret: 'must-not-store' }),
    ])
    check(
      !JSON.stringify(
        (await db.query('select details from enterprise_heartbeats')).rows,
      ).includes('must-not-store'),
      'operational details allowlisted',
    )
    let ops = await scalar('select enterprise_operations($1,$2)', [
      f.org,
      f.user,
    ])
    check(
      ops.services.find((s) => s.component === 'gateway').state === 'ready',
      'fresh process sample ready',
    )
    await db.query(
      "update enterprise_heartbeats set observed_at=now()-interval '5 minutes' where instance_id=$1",
      [instance],
    )
    ops = await scalar('select enterprise_operations($1,$2)', [f.org, f.user])
    check(
      ops.services.find((s) => s.component === 'gateway').state === 'unknown',
      'stopped/stale monitoring never reports healthy',
    )
    await scalar("select enterprise_heartbeat($1,'gateway',false)", [instance])
    ops = await scalar('select enterprise_operations($1,$2)', [f.org, f.user])
    check(
      ops.services.find((s) => s.component === 'gateway').state === 'degraded',
      'observed failed readiness distinguished from missing evidence',
    )
    console.log(
      'PASS ' + n + ' enterprise email/management-job/health/failure checks',
    )
  } finally {
    for (const [name, value] of Object.entries({
      RESEND_API_KEY: saved.key,
      STRUCT_ALERT_EMAIL_FROM: saved.from,
      STRUCT_APP_URL: saved.origin,
    })) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
