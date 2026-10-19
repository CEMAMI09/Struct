// Actual disposable PostgreSQL: compare the original 036 ingestion transaction
// with 037, and exercise ingestion while a real secure enrollment job runs.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  net = require('node:net'),
  { randomUUID, createHash } = require('node:crypto'),
  { performance } = require('node:perf_hooks'),
  { pathToFileURL } = require('node:url')
const { fixture } = require('../pipelines/fixture.cjs'),
  { credentials } = require('../../tcp-server/fleet/worker')
async function run() {
  const toolRoot = path.resolve('work/pipelines/postgres-tools/node_modules'),
    { default: EmbeddedPostgres } = await import(
      pathToFileURL(path.join(toolRoot, 'embedded-postgres/dist/index.js'))
    ),
    { Client } = require(path.join(toolRoot, 'pg'))
  const socket = net.createServer()
  await new Promise((r) => socket.listen(0, '127.0.0.1', r))
  const port = socket.address().port
  await new Promise((r) => socket.close(r))
  const parent = path.resolve('work/pipelines'),
    directory = path.join(parent, 'pg-' + randomUUID()),
    password = randomUUID(),
    cluster = new EmbeddedPostgres({
      databaseDir: directory,
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
    }),
    clients = []
  let started = false
  const result = {
    scope:
      'Actual local PostgreSQL SQL commit transactions; durable outbox enabled; excludes UDP/crypto/network gateway, Supabase RTT and production hardware',
    sampleCount: 500,
    stages: [],
    timestamp: new Date().toISOString(),
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
          statement_timeout: 30000,
        })
        await c.connect()
        clients.push(c)
        return c
      },
      admin = await connect()
    await admin.query(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;create publication supabase_realtime;create function gen_random_bytes(integer)returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;`,
    )
    const apply = async (file) => {
      let sql = fs
        .readFileSync('supabase/migrations/' + file, 'utf8')
        .replace(/create extension if not exists "pgcrypto";/i, '')
      if (file.startsWith('015_'))
        sql = sql.slice(0, sql.indexOf('-- Supabase supports pg_cron'))
      await admin.query(sql)
    }
    const migrations = fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()
    for (const file of migrations.filter((f) => f < '037')) await apply(file)
    const db = {
        query: (...a) => admin.query(...a),
        exec: (s) => admin.query(s),
      },
      f = await fixture(db)
    await admin.query('update delivery_pipeline_settings set enabled=true')
    await admin.query(
      "update organizations set subscription_tier='scale',stripe_quantity=20000 where id=$1",
      [f.org],
    )
    const ingestClient = await connect(),
      workerClient = await connect()
    let seq = 0
    const ingest = async (stage) => {
      const times = [],
        t = performance.now()
      for (let i = 0; i < 500; i++) {
        const sequence = seq++,
          begin = performance.now(),
          r = await ingestClient.query(
            'select ingest_secure_v2_telemetry($1,$2,$3,0,$4) outcome',
            [
              f.wireId,
              sequence,
              createHash('sha256')
                .update('load-' + sequence)
                .digest(),
              JSON.stringify([{ value: i % 256 }]),
            ],
          )
        assert.equal(r.rows[0].outcome.inserted, true)
        times.push(performance.now() - begin)
      }
      times.sort((a, b) => a - b)
      const ms = performance.now() - t
      return {
        stage,
        durationMs: ms,
        commitsPerSecond: (500 / ms) * 1000,
        medianCommitMs: times[250],
        p95CommitMs: times[475],
        maxCommitMs: times.at(-1),
      }
    }
    // The fixture exposes credential.wire_device_id; no wire identity is invented.
    f.wireId = Number(
      (
        await admin.query('select wire_device_id from devices where id=$1', [
          f.device,
        ])
      ).rows[0].wire_device_id,
    )
    result.stages.push(await ingest('036 baseline'))
    await apply('037_fleet_management.sql')
    await admin.query('update fleet_settings set enabled=true')
    result.stages.push(await ingest('037 idle'))
    const job = (
      await admin.query(
        "select fleet_preview($1,$2,$3,'create','{}',$4,null) id",
        [
          f.org,
          f.user,
          randomUUID(),
          JSON.stringify(
            Array.from({ length: 500 }, (_, i) => ({
              name: 'Concurrent ' + i,
              external_id: 'concurrent-' + i,
            })),
          ),
        ],
      )
    ).rows[0].id
    await admin.query("select fleet_job_action($1,$2,$3,'confirm')", [
      f.org,
      f.user,
      job,
    ])
    const startedAt = performance.now(),
      worker = async () => {
        for (let i = 0; i < 500; i++) {
          const c = (await workerClient.query('select fleet_claim() claim'))
            .rows[0].claim
          assert(c)
          assert.equal(
            (
              await workerClient.query(
                'select fleet_finish($1,$2,$3,$4) outcome',
                [
                  job,
                  c.item.item_index,
                  c.item.lease_token,
                  JSON.stringify(credentials()),
                ],
              )
            ).rows[0].outcome,
            'created',
          )
        }
        return performance.now() - startedAt
      }
    const [mixed, jobMs] = await Promise.all([
      ingest('037 with concurrent same-workspace enrollment'),
      worker(),
    ])
    result.stages.push(mixed)
    result.bulkJob = {
      devices: 500,
      durationMs: jobMs,
      devicesPerSecond: (500 / jobMs) * 1000,
    }
    assert.equal(
      Number(
        (
          await admin.query(
            'select count(*) from telemetry where device_id=$1',
            [f.device],
          )
        ).rows[0].count,
      ),
      1500,
    )
    assert.equal(
      Number(
        (
          await admin.query(
            'select count(*) from webhook_deliveries where device_id=$1',
            [f.device],
          )
        ).rows[0].count,
      ),
      1500,
    )
    result.eventsPersisted = 1500
    result.deliveryIntents = 1500
    result.memory = process.memoryUsage()
    result.postgresVersion = (
      await admin.query('show server_version')
    ).rows[0].server_version
    result.migrationSHA256 = createHash('sha256')
      .update(fs.readFileSync('supabase/migrations/037_fleet_management.sql'))
      .digest('hex')
    fs.writeFileSync(
      'docs/phase-6/evidence/ingestion-load.json',
      JSON.stringify(result, null, 2),
    )
    console.log(JSON.stringify(result))
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()))
    if (started) await cluster.stop()
    if (
      path.dirname(directory) !== parent ||
      !/^pg-[0-9a-f-]{36}$/.test(path.basename(directory))
    )
      throw Error('Unsafe fixture cleanup')
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
