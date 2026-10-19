// Optional real multi-backend qualification. All credentials and data are disposable.
// Install tools under work/pipelines/postgres-tools, never into production packages.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { randomUUID, createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { setup } = require('./fixture.cjs')
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
  const parent = path.resolve('work/management'),
    dataDir = path.join(parent, 'pg-' + randomUUID())
  fs.mkdirSync(parent, { recursive: true })
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
        query: (...a) => admin.query(...a),
        exec: (s) => admin.query(s),
        close: async () => {},
      },
      f = await setup(db),
      scalar = f.scalar
    const rollout = await f.preview(f.definition)
    await f.admin('confirm', { id: rollout, kind: 'firmware', confirm: true })
    const abandoned = await connect()
    abandoned.on('error', () => {})
    await abandoned.query('begin')
    await abandoned.query('select management_tick()')
    const pid = (await abandoned.query('select pg_backend_pid() pid')).rows[0]
      .pid
    check(
      (await scalar('select count(*)::int from device_operations')) === 0,
      'Uncommitted scheduling invisible',
    )
    await admin.query('select pg_terminate_backend($1)', [pid])
    await new Promise((r) => setTimeout(r, 100))
    check(
      (await scalar('select count(*)::int from device_operations')) === 0,
      'Killed scheduler transaction leaves no partial assignment',
    )
    const workers = await Promise.all(
      Array.from({ length: 8 }, () => connect()),
    )
    await Promise.all(workers.map((c) => c.query('select management_tick()')))
    check(
      (await scalar(
        'select count(*)::int from device_operations where rollout_id=$1',
        [rollout],
      )) === 1,
      'Eight schedulers create one logical device operation',
    )
    check(
      (await scalar(
        'select next_generation from device_management_profiles where device_id=$1',
        [f.device],
      )) === '1',
      'Generation increment atomic',
    )
    const crypto = require('node:crypto'),
      core = require('../../protocol/management/core.cjs'),
      challenge = crypto.randomUUID(),
      nonce = crypto.randomBytes(32),
      hash = 'ab'.repeat(32)
    await scalar('select management_challenge($1,$2,$3,$4)', [
      f.wireId,
      challenge,
      core.digest(nonce),
      hash,
    ])
    const outcomes = await Promise.allSettled(
      workers
        .slice(0, 2)
        .map((c) =>
          c.query("select management_device($1,$2,$3,$4,'poll',$5)", [
            f.wireId,
            challenge,
            core.digest(nonce),
            hash,
            JSON.stringify({
              downloadId: crypto.randomUUID(),
              downloadHash: 'cd'.repeat(32),
            }),
          ]),
        ),
    )
    check(
      outcomes.filter((r) => r.status === 'fulfilled').length === 1,
      'Concurrent identical one-use challenge consumed once',
    )
    check(
      outcomes.filter((r) => r.status === 'rejected').length === 1,
      'Replay transaction rejected',
    )
    const operation = await scalar(
      'select to_jsonb(o) from device_operations o where rollout_id=$1',
      [rollout],
    )
    await f.admin('cancel', { id: rollout })
    check(
      (await scalar('select state from device_operations where id=$1', [
        operation.id,
      ])) === 'assigned',
      'Cancel preserves already assigned operation',
    )
    await admin.query('set role authenticated')
    await assert.rejects(
      admin.query('select * from firmware_download_tokens'),
      /permission denied/,
    )
    checks++
    await assert.rejects(
      admin.query('select management_tick()'),
      /permission denied/,
    )
    checks++
    await admin.query('reset role')
    fs.writeFileSync(
      'docs/phase-10/evidence/postgres.json',
      JSON.stringify(
        {
          at: new Date().toISOString(),
          checks,
          postgres: await scalar('select version()'),
          boundary:
            'Actual local PostgreSQL multi-backend transactions, backend termination/recovery, concurrent nonce consumption and grants. Not hosted Supabase Storage/Auth or physical devices.',
          migrationHashes: hashes,
        },
        null,
        2,
      ),
    )
    console.log(
      `PASS ${checks} actual PostgreSQL concurrent scheduling/crash/nonce/RLS checks`,
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
