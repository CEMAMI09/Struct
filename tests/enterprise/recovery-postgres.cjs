// Real cold PostgreSQL backup/restore in UUID-named loopback-only directories.
const fs = require('node:fs'),
  path = require('node:path'),
  net = require('node:net'),
  assert = require('node:assert/strict'),
  { pathToFileURL } = require('node:url'),
  { randomUUID, randomBytes, createHash } = require('node:crypto'),
  { performance } = require('node:perf_hooks')
const { fixture } = require('../pipelines/fixture.cjs'),
  { encryptSecret, decryptSecret } = require('../../tcp-server/auth'),
  { processFrame } = require('../../tcp-server/ingest'),
  wire = require('../../sdk/js/secure-v2.cjs')
async function run() {
  const tools = path.resolve('work/pipelines/postgres-tools/node_modules'),
    { default: EmbeddedPostgres } = await import(
      pathToFileURL(path.join(tools, 'embedded-postgres/dist/index.js'))
    ),
    { Client } = require(path.join(tools, 'pg'))
  fs.mkdirSync('work/enterprise', { recursive: true })
  const root = fs.realpathSync(process.cwd()),
    parent = fs.realpathSync('work/enterprise')
  assert(parent.startsWith(root + path.sep), 'Workspace containment')
  const server = net.createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await new Promise((r) => server.close(r))
  const original = path.join(parent, 'pg-source-' + randomUUID()),
    restored = path.join(parent, 'pg-restored-' + randomUUID()),
    password = randomUUID(),
    options = {
      port,
      user: 'postgres',
      password,
      authMethod: 'scram-sha-256',
      persistent: true,
      createPostgresUser: false,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      postgresFlags: [
        '-c',
        'listen_addresses=127.0.0.1',
        '-c',
        'max_connections=12',
      ],
      onLog: () => {},
      onError: () => {},
    }
  const source = new EmbeddedPostgres({ ...options, databaseDir: original }),
    recovery = new EmbeddedPostgres({ ...options, databaseDir: restored })
  let sourceRunning = false,
    recoveryRunning = false,
    admin,
    checks = 0
  const check = (v, m) => {
      assert(v, m)
      checks++
    },
    scalar = async (sql, args = []) =>
      Object.values((await admin.query(sql, args)).rows[0])[0]
  const connect = async () => {
    const c = new Client({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password,
      database: 'postgres',
      statement_timeout: 30000,
    })
    c.on('error', () => {})
    await c.connect()
    return c
  }
  const result = {
    timestamp: new Date().toISOString(),
    boundary:
      'Actual disposable PostgreSQL cold filesystem backup/restore, matching local server version. Not hosted Supabase/PITR, offsite encrypted backups or a contractual RPO/RTO.',
  }
  try {
    await source.initialise()
    await source.start()
    sourceRunning = true
    admin = await connect()
    await admin.query(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;create publication supabase_realtime;create function gen_random_bytes(integer)returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;",
    )
    for (const file of fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      let sql = fs
        .readFileSync('supabase/migrations/' + file, 'utf8')
        .replace(/create extension if not exists "pgcrypto";/i, '')
      if (file.startsWith('015_'))
        sql = sql.slice(0, sql.indexOf('-- Supabase supports pg_cron'))
      await admin.query(sql)
    }
    const db = {
        query: (...args) => admin.query(...args),
        exec: (s) => admin.query(s),
      },
      f = await fixture(db)
    await admin.query(
      'update enterprise_settings set enabled=true;update delivery_pipeline_settings set enabled=true',
    )
    // Actual concurrent PostgreSQL sessions, not a single serialized PGlite connection.
    const secondOwner=randomUUID()
    await admin.query('insert into auth.users(id,email) values($1,$2)',[secondOwner,'second-owner@example.invalid'])
    await admin.query("update organizations set subscription_tier='scale' where id=$1",[f.org])
    await admin.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')",[f.org,secondOwner])
    const ownerRows=(await admin.query("select id,user_id from organization_members where organization_id=$1 and role='owner'",[f.org])).rows
    const c1=await connect(),c2=await connect()
    try {
      const removals=await Promise.allSettled(ownerRows.map((row,i)=>(i?c2:c1).query("select enterprise_team_command($1,$2,'remove',$3)",[f.org,row.user_id,JSON.stringify({member:row.id})])))
      check(removals.filter(r=>r.status==='fulfilled').length===1,'simultaneous owner removals cannot remove every owner')
      check((await scalar("select count(*)::int from organization_members where organization_id=$1 and role='owner'",[f.org]))===1,'last-owner invariant holds under real concurrency')
      await admin.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner') on conflict(organization_id,user_id) do update set role='owner'",[f.org,f.user])
    } finally {await c1.end();await c2.end()}
    await f.ingest(0, [42, 43])
    const baselineReplay = await scalar(
        'select row_to_json(s) from secure_v2_replay_state s where wire_device_id=$1',
        [f.wireId],
      ),
      baselineEvents = await scalar(
        'select count(*)::int from telemetry_events',
      ),
      baselineOutbox = await scalar(
        'select count(*)::int from webhook_deliveries',
      )
    result.backupHighestSequence = baselineReplay.highest_sequence
    result.backupEvents = baselineEvents
    result.backupDeliveryIntents = baselineOutbox
    result.postgresVersion = await scalar('show server_version')
    await admin.end()
    admin = null
    await source.stop()
    sourceRunning = false
    const backupBegin = performance.now()
    assert(!fs.existsSync(restored))
    assert.strictEqual(path.dirname(restored), parent)
    fs.cpSync(original, restored, { recursive: true })
    result.coldCopyMs = performance.now() - backupBegin
    await source.start()
    sourceRunning = true
    admin = await connect()
    await admin.query("select set_config('request.jwt.claim.sub',$1,false)", [
      f.user,
    ])
    await f.ingest(1)
    check(
      (await scalar('select count(*)::int from telemetry_events')) ===
        baselineEvents + 1,
      'post-backup accepted event demonstrates recovery-point gap',
    )
    await admin.end()
    admin = null
    await source.stop()
    sourceRunning = false
    const restoreBegin = performance.now()
    await recovery.start()
    recoveryRunning = true
    admin = await connect()
    await scalar("select enterprise_quarantine('restore')")
    result.startAndQuarantineMs = performance.now() - restoreBegin
    check(
      (await scalar('select count(*)::int from telemetry_events')) ===
        baselineEvents,
      'backup telemetry restored exactly',
    )
    check(
      (await scalar('select count(*)::int from webhook_deliveries')) ===
        baselineOutbox,
      'durable outbox preserved without dispatch',
    )
    check(
      JSON.stringify(
        await scalar(
          'select row_to_json(s) from secure_v2_replay_state s where wire_device_id=$1',
          [f.wireId],
        ),
      ) === JSON.stringify(baselineReplay),
      'replay bitmap/counter restored exactly',
    )
    const row = await scalar(
      'select row_to_json(c) from secure_v2_credentials c where wire_device_id=$1',
      [f.wireId],
    )
    check(
      decryptSecret(row.root_secret_encrypted) === f.root,
      'encrypted root works with independently retained recovery key',
    )
    const savedKey = process.env.TCP_CREDENTIAL_KEY
    process.env.TCP_CREDENTIAL_KEY = '56'.repeat(32)
    assert.throws(() => decryptSecret(row.root_secret_encrypted))
    checks++
    process.env.TCP_CREDENTIAL_KEY = savedKey
    await assert.rejects(f.ingest(1), /RECOVERY_INGESTION_BLOCKED/)
    checks++
    await assert.rejects(
      scalar('select enterprise_release_recovery()'),
      /RESTORED_CREDENTIALS_REQUIRE_REPROVISIONING/,
    )
    checks++
    await admin.query("select set_config('request.jwt.claim.sub',$1,false)", [
      f.user,
    ])
    const newRoot = randomBytes(32).toString('hex'),
      bootstrap = randomBytes(32).toString('hex'),
      epoch = await scalar(
        'select row_to_json(enroll_device_secure_v2($1,$2,$3,$4,$5,$6,true,0))',
        [
          f.device,
          f.org,
          encryptSecret(newRoot),
          'test',
          encryptSecret(bootstrap),
          createHash('sha256').update(Buffer.from(bootstrap, 'hex')).digest(),
        ],
      )
    check(
      Number(epoch.wire_device_id) !== f.wireId,
      'manual reprovisioning creates fresh wire/key epoch',
    )
    await scalar('select enterprise_release_recovery()')
    await assert.rejects(f.ingest(1), /authentication failed/)
    checks++
    const packet = wire.buildFrame({
        rootSecret: newRoot,
        wireDeviceId: Number(epoch.wire_device_id),
        sequence: 0,
        slot: 0,
        confirmed: true,
        payload: Buffer.from([44]),
      }),
      accepted = await processFrame(packet, {
        supabase: f.adapter,
        transport: 'udp',
      })
    check(
      accepted.receipt &&
        wire.verifyReceipt(
          accepted.receipt,
          newRoot,
          Number(epoch.wire_device_id),
          0,
        ),
      'fresh epoch commits with valid authenticated receipt',
    )
    check(
      (await scalar('select count(*)::int from webhook_deliveries')) ===
        baselineOutbox + 1,
      'new delivery intent after recovery, old queue retained',
    )
    result.verifiedRecoveryMs = performance.now() - restoreBegin
    result.lostPostSnapshotEvents = 1
    result.testsPassed = checks
    result.security =
      'Ingestion quarantined before reopening; all restored active epochs must be replaced/revoked. Old packet rejected, new epoch accepted. Physical firmware update remains a manual prerequisite.'
    result.migrationSHA256 = Object.fromEntries(
      ['039_enterprise_roles.sql', '040_enterprise_operations.sql'].map((f) => [
        f,
        createHash('sha256')
          .update(fs.readFileSync('supabase/migrations/' + f))
          .digest('hex'),
      ]),
    )
    fs.writeFileSync(
      'docs/phase-9/evidence/recovery-postgres.json',
      JSON.stringify(result, null, 2) + '\n',
    )
    console.log(
      'PASS ' +
        checks +
        ' actual PostgreSQL cold backup/restore/quarantine/epoch checks',
    )
  } finally {
    if (admin) await admin.end().catch(() => {})
    if (sourceRunning) await source.stop()
    if (recoveryRunning) await recovery.stop()
    for (const dir of [original, restored]) {
      assert.strictEqual(path.dirname(path.resolve(dir)), parent)
      assert(/^pg-(source|restored)-[a-f0-9-]{36}$/.test(path.basename(dir)))
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
