// Optional real multi-backend qualification. All credentials and data are disposable.
// Install tools under work/pipelines/postgres-tools, never into production packages.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { randomUUID, createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { fixture } = require('../pipelines/fixture.cjs')
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

    await admin.query('update fleet_settings set enabled=true')
    await admin.query(
      "update organizations set subscription_tier='scale',stripe_quantity=100 where id=$1",
      [f.org],
    )
    const peers = await Promise.all(Array.from({ length: 4 }, connect))
    const preview = async (c, rows, request = randomUUID()) =>
      (
        await c.query(
          "select fleet_preview($1,$2,$3,'create','{}',$4,null) id",
          [f.org, f.user, request, JSON.stringify(rows)],
        )
      ).rows[0].id
    const request = randomUUID()
    const same = await Promise.all(
      peers.map((c) =>
        preview(c, [{ name: 'Concurrent', external_id: 'same' }], request),
      ),
    )
    check(new Set(same).size === 1, 'concurrent idempotent preview')
    await admin.query("select fleet_job_action($1,$2,$3,'confirm')", [
      f.org,
      f.user,
      same[0],
    ])
    const claims = await Promise.all(
      peers.map((c) => c.query('select fleet_claim() claim')),
    )
    const claimed = claims.map((r) => r.rows[0].claim).filter(Boolean)
    check(claimed.length === 1, 'one concurrent item lease')
    const { credentials } = require('../../tcp-server/fleet/worker')
    const args = [
      same[0],
      0,
      claimed[0].item.lease_token,
      JSON.stringify(credentials()),
    ]
    const finish = await Promise.all(
      peers.map((c) =>
        c.query('select fleet_finish($1,$2,$3,$4) outcome', args),
      ),
    )
    check(
      finish.filter((r) => r.rows[0].outcome === 'created').length === 1,
      'one committed device across identical concurrent completions',
    )
    check(
      (
        await admin.query(
          "select count(*)::int n from devices where external_id='same'",
        )
      ).rows[0].n === 1,
      'unique stable device',
    )
    const j1 = await preview(admin, [{ name: 'A', external_id: 'collision' }]),
      j2 = await preview(admin, [{ name: 'B', external_id: 'collision' }])
    await admin.query("select fleet_job_action($1,$2,$3,'confirm')", [
      f.org,
      f.user,
      j1,
    ])
    await admin.query("select fleet_job_action($1,$2,$3,'confirm')", [
      f.org,
      f.user,
      j2,
    ])
    const cs = await Promise.all(
      peers.slice(0, 2).map((c) => c.query('select fleet_claim() claim')),
    )
    check(
      cs.every((r) => r.rows[0].claim),
      'two jobs claim independently',
    )
    const os = await Promise.all(
      cs.map((r, i) => {
        const q = r.rows[0].claim
        return peers[i].query('select fleet_finish($1,$2,$3,$4) result', [
          q.job.id,
          q.item.item_index,
          q.item.lease_token,
          JSON.stringify(credentials()),
        ])
      }),
    )
    check(
      os.filter((r) => r.rows[0].result === 'created').length === 1 &&
        os.filter((r) => r.rows[0].result === 'failed').length === 1,
      'cross-job identity collision is serialized, reported',
    )
    const crash = await preview(admin, [
      { name: 'Crash', external_id: 'crash' },
    ])
    await admin.query("select fleet_job_action($1,$2,$3,'confirm')", [
      f.org,
      f.user,
      crash,
    ])
    const before = (await peers[0].query('select fleet_claim() claim')).rows[0]
      .claim
    await peers[0].query('begin')
    await peers[0].query('select fleet_finish($1,$2,$3,$4)', [
      crash,
      0,
      before.item.lease_token,
      JSON.stringify(credentials()),
    ])
    const pid = (await peers[0].query('select pg_backend_pid() pid')).rows[0]
      .pid
    peers[0].on('error', () => {})
    await admin.query('select pg_terminate_backend($1)', [pid])
    await new Promise((resolve) => setTimeout(resolve, 100))
    check(
      (
        await admin.query(
          "select count(*)::int n from devices where external_id='crash'",
        )
      ).rows[0].n === 0,
      'killed transaction leaves no device',
    )
    await admin.query(
      "update fleet_job_items set lease_until=now()-interval '1 second' where job_id=$1",
      [crash],
    )
    const after = (await peers[1].query('select fleet_claim() claim')).rows[0]
      .claim
    check(
      after.item.lease_token !== before.item.lease_token,
      'worker/backend death reclaimed',
    )
    check(
      (
        await peers[1].query('select fleet_finish($1,$2,$3,$4) result', [
          crash,
          0,
          after.item.lease_token,
          JSON.stringify(credentials()),
        ])
      ).rows[0].result === 'created',
      'recovery after transaction rollback',
    )
    const row = (
      await admin.query(
        "select id,admin_version from devices where external_id='crash'",
      )
    ).rows[0]
    const disable = (
      await admin.query(
        "select fleet_preview($1,$2,$3,'disable','{}',$4,null) id",
        [
          f.org,
          f.user,
          randomUUID(),
          JSON.stringify([{ id: row.id, version: row.admin_version }]),
        ],
      )
    ).rows[0].id
    await admin.query("select fleet_job_action($1,$2,$3,'confirm')", [
      f.org,
      f.user,
      disable,
    ])
    const pending = (await admin.query('select fleet_claim() claim')).rows[0]
      .claim
    const races = await Promise.allSettled([
      peers[1].query('select fleet_finish($1,$2,$3,null)', [
        disable,
        0,
        pending.item.lease_token,
      ]),
      peers[2].query(
        "insert into telemetry(device_id,parsed_json)values($1,'{}')",
        [row.id],
      ),
    ])
    check(
      races[0].status === 'fulfilled',
      'disable/ingestion race completes without deadlock',
    )
    await assert.rejects(
      admin.query(
        "insert into telemetry(device_id,parsed_json)values($1,'{}')",
        [row.id],
      ),
      /NOT_ENABLED/,
    )
    checks++
    fs.mkdirSync('docs/phase-6/evidence', { recursive: true })
    fs.writeFileSync(
      'docs/phase-6/evidence/postgres.json',
      JSON.stringify(
        {
          checks,
          backends: 4,
          version: (await admin.query('show server_version')).rows[0]
            .server_version,
          scope:
            'actual PostgreSQL concurrent transactions and terminated backend; not physical hardware/cloud',
          migration_sha256: hashes,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    )
    console.log(
      'PASS ' + checks + ' real PostgreSQL fleet concurrency/crash checks',
    )
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
