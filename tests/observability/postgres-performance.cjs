// Actual disposable PostgreSQL commit/metrics overhead and concurrent rollup qualification.
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
      'Actual local PostgreSQL SQL transactions with synthetic 1-byte sensor metadata; excludes UDP/crypto, Supabase RTT and production hardware; no physical fleet throughput claim',
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
    for (const file of migrations.filter((f) => f < '038')) await apply(file)
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
    const ingest = async (stage, observed = false) => {
      const times = [],
        t = performance.now()
      for (let i = 0; i < 500; i++) {
        const sequence = seq++,
          begin = performance.now(),
          r = await ingestClient.query(
            observed
              ? 'select ingest_secure_v2_observed($1,$2,$3,0,$4,$5) outcome'
              : 'select ingest_secure_v2_telemetry($1,$2,$3,0,$4) outcome',
            [
              f.wireId,
              sequence,
              createHash('sha256')
                .update('load-' + sequence)
                .digest(),
              JSON.stringify([{ value: i % 256 }]),
              ...(observed
                ? [
                    JSON.stringify({
                      app_bytes: 26,
                      payload_bytes: 1,
                      framing_bytes: 9,
                      ip_version: 4,
                      processing_ms: 0,
                    }),
                  ]
                : []),
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
    result.stages.push(await ingest('037 baseline'))
    await apply('038_monitoring_analytics.sql')
    await admin.query('update observability_settings set enabled=true')
    result.stages.push(await ingest('038 observed idle', true))
    const startedAt = performance.now()
    const worker = async () => {
      let processed = 0
      for (let i = 0; i < 500; i++)
        processed += Number(
          (await workerClient.query('select aggregate_metric_events(25) n'))
            .rows[0].n,
        )
      return processed
    }
    const [mixed, processed] = await Promise.all([
      ingest('038 with concurrent aggregation', true),
      worker(),
    ])
    result.stages.push(mixed)
    const another = await connect()
    let remaining = 1
    while (remaining) {
      const a = await Promise.all([
        workerClient.query('select aggregate_metric_events(100) n'),
        another.query('select aggregate_metric_events(100) n'),
      ])
      remaining = a.reduce((n, r) => n + Number(r.rows[0].n), 0)
    }
    assert.equal(
      Number(
        (
          await admin.query(
            "select sum(readings) n from usage_rollups where grain='hour'",
          )
        ).rows[0].n,
      ),
      1000,
    )
    result.aggregation = {
      processedDuringMixed: processed,
      measuredDurationMs: performance.now() - startedAt,
      logicalReadings: 1000,
      concurrentWorkers: 2,
    }
    const rule = (
      await admin.query("select observability_command($1,$2,'rule',$3) r", [
        f.org,
        f.user,
        JSON.stringify({
          name: 'Concurrent bytes',
          kind: 'bytes',
          threshold: 1,
          clear: 0,
          enabled: true,
        }),
      ])
    ).rows[0].r.id
    await Promise.all([
      workerClient.query('select evaluate_alert_rule($1)', [rule]),
      another.query('select evaluate_alert_rule($1)', [rule]),
    ])
    assert.equal(
      Number(
        (await admin.query('select count(*) n from alert_incidents')).rows[0].n,
      ),
      1,
    )
    result.concurrentIncidentDeduplication = true
    const beginQuery = performance.now()
    for (let i = 0; i < 20; i++)
      await admin.query(
        "select usage_analytics($1,$2,now()-interval '1 hour',now()+interval '1 minute')",
        [f.org, f.user],
      )
    result.meanAnalyticsQueryMs = (performance.now() - beginQuery) / 20
    const evalBegin = performance.now()
    await admin.query('select evaluate_alert_rule($1)', [rule])
    result.alertEvaluationMs = performance.now() - evalBegin
    // Terminate a real backend after uncommitted rollup writes; work must remain pending.
    await admin.query(
      "insert into metric_events(event_key,organization_id,device_id,kind,app_bytes,ip_version) values('crash-qualification',$1,$2,'duplicate',26,4)",
      [f.org, f.device],
    )
    const workerPid = (await workerClient.query('select pg_backend_pid() pid'))
      .rows[0].pid
    workerClient.on('error', () => {})
    await workerClient.query('begin')
    await workerClient.query('select aggregate_metric_events(100)')
    await admin.query('select pg_terminate_backend($1)', [workerPid])
    assert.equal(
      (
        await admin.query(
          "select processed_at is null pending from metric_events where event_key='crash-qualification'",
        )
      ).rows[0].pending,
      true,
    )
    await another.query('select aggregate_metric_events(100)')
    assert.equal(
      Number(
        (await another.query('select aggregate_metric_events(100) n')).rows[0]
          .n,
      ),
      0,
    )
    assert.equal(
      Number(
        (
          await admin.query(
            "select sum(packets) n from usage_rollups where grain='hour'",
          )
        ).rows[0].n,
      ),
      1001,
    )
    result.terminatedBackendRecovery = true
    result.storage = (
      await admin.query(
        "select pg_total_relation_size('metric_events')::text packetMetrics,pg_total_relation_size('usage_rollups')::text rollups,pg_total_relation_size('metric_identity')::text identities",
      )
    ).rows[0]
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
      .update(
        fs.readFileSync('supabase/migrations/038_monitoring_analytics.sql'),
      )
      .digest('hex')
    fs.writeFileSync(
      'docs/phase-5-8/evidence/postgres-performance.json',
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
