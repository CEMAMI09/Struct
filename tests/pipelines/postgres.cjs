// Optional real multi-backend qualification. All credentials and data are disposable.
// Install tools under work/pipelines/postgres-tools, never into production packages.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { randomUUID, createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { fixture } = require('./fixture.cjs')
;(async () => {
  const tools = path.resolve('work/pipelines/postgres-tools/node_modules')
  const { default: EmbeddedPostgres } = await import(
    pathToFileURL(path.join(tools, 'embedded-postgres/dist/index.js'))
  )
  const { Client } = require(path.join(tools, 'pg'))
  const listener = net.createServer()
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise((resolve) => listener.close(resolve))
  const parent = path.resolve('work/pipelines'),
    dataDir = path.join(parent, 'pg-' + randomUUID())
  const password = randomUUID()
  const cluster = new EmbeddedPostgres({
    databaseDir: dataDir,
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
      'max_connections=24',
      '-c',
      'deadlock_timeout=100ms',
    ],
    onLog: () => {},
    onError: () => {},
  })
  let admin,
    started = false
  const clients = []
  let checks = 0
  const check = (value, message) => {
    assert(value, message)
    checks++
  }
  try {
    await cluster.initialise()
    await cluster.start()
    started = true
    const connect = async () => {
      const c = new Client({
        host: '127.0.0.1',
        port,
        user: 'postgres',
        password,
        database: 'postgres',
        statement_timeout: 15000,
      })
      await c.connect()
      clients.push(c)
      return c
    }
    admin = await connect()
    await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon,service_role;create publication supabase_realtime;
      create function gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;`)
    const hashes = {}
    for (const file of fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      let sql = fs.readFileSync(path.join('supabase/migrations', file), 'utf8')
      hashes[file] = createHash('sha256').update(sql).digest('hex')
      sql = sql.replace(/create extension if not exists "pgcrypto";/i, '')
      if (file.startsWith('015_'))
        sql = sql.slice(0, sql.indexOf('-- Supabase supports pg_cron'))
      await admin.query(sql)
    }
    const db = {
      query: (...args) => admin.query(...args),
      exec: (sql) => admin.query(sql),
      close: async () => {},
    }
    const f = await fixture(db)
    await admin.query('update delivery_pipeline_settings set enabled=true')
    const workers = await Promise.all(Array.from({ length: 8 }, connect))
    for (const c of workers)
      await c.query("select set_config('request.jwt.claim.sub',$1,false)", [
        f.user,
      ])
    const pid = await Promise.all(
      workers.map((c) => c.query('select pg_backend_pid() pid')),
    )
    check(
      new Set(pid.map((r) => r.rows[0].pid)).size === 8,
      'eight actual PostgreSQL backends',
    )
    const digest = Buffer.alloc(32, 4)
    const duplicates = await Promise.all(
      workers.map((c) =>
        c.query('select ingest_secure_v2_telemetry($1,0,$2,0,$3) result', [
          f.wireId,
          digest,
          '[{"value":42}]',
        ]),
      ),
    )
    check(
      duplicates.filter((r) => r.rows[0].result.inserted).length === 1,
      'one concurrent insert',
    )
    check(
      new Set(duplicates.map((r) => r.rows[0].result.event_ids[0])).size === 1,
      'same original event across concurrent retries',
    )
    check(
      (await f.scalar('select count(*)::integer from webhook_deliveries')) ===
        1,
      'one concurrent logical delivery',
    )
    await admin.query(
      "insert into destinations(user_id,organization_id,name,url,signing_secret) select $1,$2,'Parallel '||n,'https://example.com/'||n,'test' from generate_series(1,11) n",
      [f.user, f.org],
    )
    await f.ingest(1, [1, 2, 3, 4, 5])
    const began = performance.now()
    const claims = (
      await Promise.all(
        workers.map((c) =>
          c.query('select * from claim_webhook_deliveries_v2(8)'),
        ),
      )
    ).flatMap((r) => r.rows)
    check(claims.length === 8, 'tenant global concurrency capped at eight')
    check(
      new Set(claims.map((j) => j.id)).size === 8,
      'claims unique under real contention',
    )
    check(
      new Set(claims.map((j) => j.destination_id)).size === 8,
      'one in-flight per endpoint',
    )
    await Promise.all(
      claims.map((j, i) =>
        workers[i].query(
          "select finish_webhook_delivery_v2($1,$2,'delivered')",
          [j.id, j.lease_token],
        ),
      ),
    )
    check(
      (await f.scalar(
        "select count(*)::integer from webhook_attempts where outcome='delivered'",
      )) === 8,
      'parallel finishes durable',
    )
    await admin.query(
      "update webhook_deliveries set status='dead',lease_until=null,lease_token=null",
    )
    const id = claims[0].id,
      requestId = randomUUID()
    const recoveries = await Promise.all(
      workers.map((c) =>
        c.query("select delivery_recovery($1,$2,'retry',$3,true) result", [
          f.org,
          [id],
          requestId,
        ]),
      ),
    )
    check(
      recoveries.filter((r) => !r.rows[0].result.duplicate_request).length ===
        1,
      'concurrent replay request scheduled once',
    )
    check(
      (await f.scalar(
        'select replay_count from webhook_deliveries where id=$1',
        [id],
      )) === 1,
      'replay count increased once',
    )
    // Conflicting lock orders are exercised by ingestion, claims, completion and
    // recovery on distinct backends; any deadlock/timeout fails the test.
    await admin.query(
      'update webhook_destination_runtime set next_dispatch_at=now()',
    )
    await Promise.all([
      ...workers
        .slice(0, 4)
        .map((c, i) =>
          c.query('select ingest_secure_v2_telemetry($1,$2,$3,0,$4)', [
            f.wireId,
            10 + i,
            Buffer.alloc(32, 10 + i),
            '[{"value":10}]',
          ]),
        ),
      ...workers
        .slice(4)
        .map((c) => c.query('select * from claim_webhook_deliveries_v2(2)')),
    ])
    check(true, 'mixed ingestion/claim transactions finish without deadlock')
    await admin.query(
      "update webhook_deliveries set status='dead',lease_token=null,lease_until=null",
    )
    const other = await fixture(db)
    await other.ingest(0)
    await f.ingest(90)
    await admin.query(
      'update webhook_destination_runtime set next_dispatch_at=now()',
    )
    const tenantClaims = []
    // A locked tenant can legitimately be skipped for one polling round.
    // Verify eventual capacity across three bounded rounds, not a particular
    // interleaving of eight simultaneous transactions.
    for (let round = 0; round < 3; round++) {
      tenantClaims.push(
        ...(
          await Promise.all(
            workers.map((c) =>
              c.query('select * from claim_webhook_deliveries_v2(8)'),
            ),
          )
        ).flatMap((r) => r.rows),
      )
    }
    check(
      tenantClaims.filter((j) => j.organization_id === f.org).length === 8,
      'busy tenant limited globally',
    )
    check(
      tenantClaims.filter((j) => j.organization_id === other.org).length === 1,
      'second tenant receives capacity',
    )
    await admin.query(
      "update webhook_deliveries set status='dead',lease_token=null,lease_until=null",
    )
    await f.ingest(99)
    await admin.query(
      'update webhook_destination_runtime set next_dispatch_at=now()',
    )
    const beforeRestart = (
      await admin.query('select * from claim_webhook_deliveries_v2(1)')
    ).rows[0]
    const serverVersion = (await admin.query('select version() version'))
      .rows[0].version
    // On Windows the wrapper terminates only its own postgres process tree.
    // Persistent data + fsync defaults exercise actual WAL recovery on restart.
    await Promise.all(clients.splice(0).map((c) => c.end()))
    await cluster.stop()
    started = false
    const unavailable = new Client({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password,
      database: 'postgres',
      connectionTimeoutMillis: 1000,
    })
    await assert.rejects(unavailable.connect(), /ECONNREFUSED/)
    checks++
    await unavailable.end()
    await cluster.start()
    started = true
    admin = await connect()
    check(
      (await f.scalar('select status from webhook_deliveries where id=$1', [
        beforeRestart.id,
      ])) === 'sending',
      'claim survives actual database termination',
    )
    await admin.query(
      "update webhook_deliveries set lease_until=now()-interval '1 second' where id=$1",
      [beforeRestart.id],
    )
    await admin.query(
      'update webhook_destination_runtime set next_dispatch_at=now()',
    )
    await admin.query('select * from claim_webhook_deliveries_v2(8)')
    check(
      (await f.scalar(
        "select count(*)::integer from webhook_attempts where delivery_id=$1 and outcome='unknown'",
        [beforeRestart.id],
      )) === 1,
      'abandoned durable claim recovered after database restart',
    )
    check(
      (await f.scalar(
        'select count(*)::integer from telemetry_events where id=$1',
        [beforeRestart.event_id],
      )) === 1,
      'event identity durable after database restart',
    )
    const runtime = performance.now() - began
    fs.writeFileSync(
      'docs/phase-3-4/evidence/postgres.json',
      JSON.stringify(
        {
          checks,
          passed: checks,
          server_version: serverVersion,
          backends: 8,
          mixed_runtime_ms: runtime,
          database_restart:
            'actual local process termination/restart; WAL recovery; fixture lease advanced to avoid 60-second wait',
          tools: { embedded_postgres: '18.4.0-beta.17', pg: '8.23.1' },
          limitations: [
            'local Windows host',
            'no Supabase REST/auth/cron service',
            'test-only auth schema and random-byte default stub',
            'not a production load qualification',
          ],
          migration_sha256: hashes,
        },
        null,
        2,
      ),
    )
    console.log(`PASS ${checks} real PostgreSQL multi-backend checks`)
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()))
    if (started) await cluster.stop()
    if (
      path.dirname(dataDir) !== parent ||
      !/^pg-[0-9a-f-]{36}$/.test(path.basename(dataDir))
    )
      throw new Error('Unsafe test cleanup path')
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error.message)
  // The portable server package installs an exit hook; pass an explicit code
  // so beforeExit cannot convert an assertion failure into a successful run.
  process.exit(1)
})
