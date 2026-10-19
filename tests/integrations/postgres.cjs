// Optional actual PostgreSQL/TLS destination test. Local override lives only here;
// production adapter refuses loopback and private databases.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  net = require('node:net'),
  { randomUUID } = require('node:crypto'),
  { pathToFileURL } = require('node:url'),
  { execFileSync } = require('node:child_process')
const {
    execute,
    closePools,
  } = require('../../tcp-server/integrations/adapters'),
  { Pool } = require('../../tcp-server/node_modules/pg'),
  { validateMapping } = require('../../tcp-server/integrations')
;(async () => {
  const { default: EmbeddedPostgres } = await import(
    pathToFileURL(
      path.resolve(
        'work/pipelines/postgres-tools/node_modules/embedded-postgres/dist/index.js',
      ),
    )
  )
  const parent = path.resolve('work/integrations'),
    dir = path.join(parent, 'pg-' + randomUUID())
  fs.mkdirSync(dir, { recursive: true })
  const key = path.join(dir, 'server.key'),
    cert = path.join(dir, 'server.crt'),
    openssl =
      process.env.STRUCT_TEST_OPENSSL ||
      'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'
  execFileSync(
    openssl,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=db.example.com',
      '-addext',
      'subjectAltName=DNS:db.example.com,IP:127.0.0.1',
    ],
    { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  )
  const listener = net.createServer()
  await new Promise((r) => listener.listen(0, '127.0.0.1', r))
  const port = listener.address().port
  await new Promise((r) => listener.close(r))
  const password = randomUUID(),
    dataDir = path.join(dir, 'data'),
    cluster = new EmbeddedPostgres({
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
        'ssl=on',
        '-c',
        `ssl_cert_file=${cert.replaceAll('\\', '/')}`,
        '-c',
        `ssl_key_file=${key.replaceAll('\\', '/')}`,
      ],
      onLog: () => {},
      onError: () => {},
    })
  let pool,
    started = false,
    passed = 0
  const check = (v, m) => {
    assert(v, m)
    passed++
  }
  try {
    await cluster.initialise()
    await cluster.start()
    started = true
    const ca = fs.readFileSync(cert, 'utf8')
    pool = new Pool({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password,
      database: 'postgres',
      ssl: { ca, rejectUnauthorized: true, servername: 'db.example.com' },
      max: 4,
    })
    await pool.query(
      'create table struct_events(event_id uuid primary key,device_id uuid not null,received_at timestamptz not null,payload jsonb not null)',
    )
    const config = {
        host: 'db.example.com',
        port,
        database: 'postgres',
        schema: 'public',
        table: 'struct_events',
      },
      secrets = { user: 'postgres', password, ca },
      snapshot = { kind: 'postgresql', config, mapping: validateMapping(null) },
      body = {
        id: randomUUID(),
        device_id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
          precise: 1.0000000000000002,
          integer: '18446744073709551615',
        },
      },
      job = { id: randomUUID() },
      dependencies = { pgFactory: () => pool }
    check(
      (
        await execute(snapshot, secrets, body, job, {
          mode: 'verify',
          dependencies,
        })
      ).level === 'connection_established',
      'read-only destination verification',
    )
    check(
      (await pool.query('select count(*)::int n from struct_events')).rows[0]
        .n === 0,
      'verification performed no insert',
    )
    const tls = (
      await pool.query(
        'select ssl,version from pg_stat_ssl where pid=pg_backend_pid()',
      )
    ).rows[0]
    check(tls.ssl === true, 'actual verified TLS connection')
    const start = performance.now(),
      results = await Promise.all(
        Array.from({ length: 20 }, () =>
          execute(snapshot, secrets, body, job, { dependencies }),
        ),
      )
    const elapsed = performance.now() - start
    check(
      results.every((r) => r.outcome === 'delivered'),
      'concurrent idempotent inserts accepted',
    )
    const row = (await pool.query('select * from struct_events')).rows
    check(row.length === 1, 'unique event identity prevents duplicate inserts')
    check(
      row[0].payload.data.integer === body.payload.integer,
      'uint64 string exact in PostgreSQL',
    )
    check(
      row[0].payload.data.precise === body.payload.precise,
      'Float64 exact round trip',
    )
    const invalid = { ...snapshot, config: { ...config, table: 'missing' } }
    check(
      (await execute(invalid, secrets, body, job, { dependencies })).outcome ===
        'dead',
      'missing table is deterministic configuration failure',
    )
    await pool.query(
      'create table no_idempotency(event_id uuid,device_id uuid,received_at timestamptz,payload jsonb)',
    )
    check(
      (
        await execute(
          { ...snapshot, config: { ...config, table: 'no_idempotency' } },
          secrets,
          body,
          job,
          { mode: 'verify', dependencies },
        )
      ).outcome === 'dead',
      'missing unique key rejected',
    )
    const hostile = "'; DROP TABLE struct_events; --",
      hostileBody = { ...body, id: randomUUID(), payload: { text: hostile } }
    check(
      (await execute(snapshot, secrets, hostileBody, job, { dependencies }))
        .outcome === 'delivered',
      'hostile value safely parameterized',
    )
    check(
      (
        await pool.query(
          "select payload->'data'->>'text' text from struct_events where event_id=$1",
          [hostileBody.id],
        )
      ).rows[0].text === hostile,
      'value preserved, table intact',
    )
    const badPool = new Pool({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password,
      database: 'postgres',
      ssl: { ca, rejectUnauthorized: true, servername: 'wrong.example.com' },
      connectionTimeoutMillis: 3000,
    })
    await assert.rejects(
      () => badPool.query('select 1'),
      /Hostname|certificate/i,
    )
    passed++
    await badPool.end()
    fs.mkdirSync('docs/phase-7/evidence', { recursive: true })
    fs.writeFileSync(
      'docs/phase-7/evidence/postgres.json',
      JSON.stringify(
        {
          passed,
          timestamp: new Date().toISOString(),
          postgres: (await pool.query('show server_version')).rows[0]
            .server_version,
          tls: tls.version,
          concurrent_20_insert_ms: elapsed,
          boundary:
            'Actual disposable PostgreSQL with verified TLS, test-only pinned loopback override; no customer database',
        },
        null,
        2,
      ),
    )
    console.log(`PASS ${passed} actual PostgreSQL/TLS destination checks`)
  } finally {
    await pool?.end()
    await closePools()
    if (started) await cluster.stop()
    const resolved = path.resolve(dir)
    if (!resolved.startsWith(parent + path.sep))
      throw new Error('Unsafe test cleanup')
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
