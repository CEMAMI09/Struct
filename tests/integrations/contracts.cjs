// Real local HTTP exchanges and AWS SDK serialization/signing. This is a contract
// receiver, NOT AWS/Azure/Google IAM or a managed-service emulator.
const assert = require('node:assert/strict'),
  http = require('node:http'),
  crypto = require('node:crypto'),
  fs = require('node:fs')
const {
    execute,
    azureAuth,
  } = require('../../tcp-server/integrations/adapters'),
  core = require('../../tcp-server/integrations'),
  { fixture } = require('../pipelines/fixture.cjs'),
  { deliver } = require('../../tcp-server/outbox')
const {
    SQSClient,
  } = require('../../tcp-server/node_modules/@aws-sdk/client-sqs'),
  {
    EventBridgeClient,
  } = require('../../tcp-server/node_modules/@aws-sdk/client-eventbridge')
process.env.STRUCT_INTEGRATION_KEY = '56'.repeat(32)
;(async () => {
  let passed = 0,
    mode = 'success',
    received = []
  const check = (v, m) => {
    assert(v, m)
    passed++
  }
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }),
    aws = {
      accessKeyId: 'AKIATESTONLY123456789',
      secretAccessKey: 'test-only-not-an-aws-key',
    },
    azure = {
      keyName: 'SendOnly',
      key: Buffer.alloc(32, 1).toString('base64'),
    },
    google = {
      clientEmail: 'sender@project-test.iam.gserviceaccount.com',
      privateKey: rsa.privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    }
  const body = {
      id: crypto.randomUUID(),
      type: 'telemetry.received',
      device_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      payload: { temperature: 23.5, count: '18446744073709551615' },
    },
    job = { id: crypto.randomUUID(), total_attempts: 1 },
    mapping = core.validateMapping(null)
  const server = http.createServer(async (req, res) => {
    const parts = []
    for await (const part of req) parts.push(part)
    const raw = Buffer.concat(parts).toString(),
      target =
        req.headers['x-test-target'] || req.headers['x-amz-target'] || '',
      data = raw
        ? (() => {
            try {
              return JSON.parse(raw)
            } catch {
              return null
            }
          })()
        : null
    received.push({ target, data, raw, headers: req.headers })
    res.setHeader('content-type', 'application/json')
    if (mode === '503')
      return res.writeHead(503, { 'retry-after': '2' }).end('{}')
    if (mode === '401') return res.writeHead(401).end('{}')
    if (target.includes('GetQueueAttributes'))
      return res.end(
        JSON.stringify({
          Attributes: {
            QueueArn: 'arn:aws:sqs:us-east-1:123456789012:telemetry',
          },
        }),
      )
    if (target.includes('SendMessage'))
      return res.end(
        JSON.stringify({
          MessageId: 'local-sqs-message',
          MD5OfMessageBody: crypto
            .createHash('md5')
            .update(data.MessageBody)
            .digest('hex'),
        }),
      )
    if (target.includes('DescribeEventBus'))
      return res.end(
        JSON.stringify({
          Name: 'telemetry',
          Arn: 'arn:aws:events:us-east-1:123456789012:event-bus/telemetry',
        }),
      )
    if (target.includes('PutEvents'))
      return res.end(
        JSON.stringify(
          mode === 'entry_throttled'
            ? {
                FailedEntryCount: 1,
                Entries: [{ ErrorCode: 'ThrottlingException' }],
              }
            : mode === 'entry_denied'
              ? {
                  FailedEntryCount: 1,
                  Entries: [{ ErrorCode: 'AccessDeniedException' }],
                }
              : {
                  FailedEntryCount: 0,
                  Entries: [{ EventId: 'local-eventbridge-event' }],
                },
        ),
      )
    if (target.includes('oauth2.googleapis.com')) {
      const assertion = new URLSearchParams(raw).get('assertion'),
        [h, p, sig] = assertion.split('.')
      assert(
        crypto.verify(
          'RSA-SHA256',
          Buffer.from(h + '.' + p),
          rsa.publicKey,
          Buffer.from(sig, 'base64url'),
        ),
      )
      assert.equal(
        JSON.parse(Buffer.from(p, 'base64url')).aud,
        'https://oauth2.googleapis.com/token',
      )
      return res.end(
        JSON.stringify({ access_token: 'local-oauth-token', expires_in: 300 }),
      )
    }
    if (target.includes('pubsub.googleapis.com')) {
      assert.equal(req.headers.authorization, 'Bearer local-oauth-token')
      return res.end(
        JSON.stringify(
          target.endsWith(':publish')
            ? { messageIds: mode === 'bad_ack' ? [] : ['local-pubsub-message'] }
            : { name: 'projects/project-test/topics/telemetry' },
        ),
      )
    }
    if (target.includes('servicebus.windows.net')) {
      const token = req.headers.authorization,
        params = new URLSearchParams(
          token.slice('SharedAccessSignature '.length),
        )
      const expected = crypto
        .createHmac('sha256', azure.key)
        .update(encodeURIComponent(params.get('sr')) + '\n' + params.get('se'))
        .digest('base64')
      assert.equal(params.get('sig'), expected)
      assert.equal(req.headers['x-ms-retrypolicy'], 'NoRetry')
      return res.writeHead(201).end()
    }
    const sig =
      'sha256=' +
      crypto.createHmac('sha256', 'local-signing').update(raw).digest('hex')
    assert.equal(req.headers['x-struct-signature'], sig)
    assert.equal(req.headers.authorization, 'Bearer local-bearer')
    res.writeHead(204).end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const localRequest = async (url, options = {}) => {
    const r = await fetch(base, {
      method: options.method || 'POST',
      headers: { ...options.headers, 'x-test-target': url },
      ...(options.method === 'GET' ? {} : { body: options.body }),
      signal: options.signal,
    })
    return {
      status: r.status,
      body: await r.text(),
      headers: Object.fromEntries(r.headers),
    }
  }
  const dependencies = {
    request: localRequest,
    postWebhook: async (url, data, headers, signal) => {
      const r = await localRequest(url, { body: data, headers, signal })
      return {
        ...r,
        ok: r.status >= 200 && r.status < 300,
        retryAfter: r.headers['retry-after'],
      }
    },
    awsFactory: (kind, c, s) =>
      new (kind === 'aws_sqs' ? SQSClient : EventBridgeClient)({
        region: c.region,
        credentials: s,
        endpoint: base,
        useQueueUrlAsEndpoint: false,
        maxAttempts: 1,
      }),
  }
  const cases = [
    [
      'http',
      { url: 'https://app.example.com/hook' },
      { signingSecret: 'local-signing', bearerToken: 'local-bearer' },
    ],
    [
      'aws_sqs',
      {
        region: 'us-east-1',
        queueUrl:
          'https://sqs.us-east-1.amazonaws.com/123456789012/telemetry.fifo',
        messageGroup: 'device',
      },
      aws,
    ],
    [
      'aws_eventbridge',
      {
        region: 'us-east-1',
        eventBus: 'telemetry',
        source: 'struct.telemetry',
        detailType: 'Telemetry',
      },
      aws,
    ],
    [
      'azure_service_bus',
      { namespace: 'company-events', entity: 'telemetry' },
      azure,
    ],
    ['google_pubsub', { project: 'project-test', topic: 'telemetry' }, google],
  ]
  let f
  try {
    for (const [kind, config, secrets] of cases) {
      const snapshot = { kind, config, mapping }
      const before = received.length
      const verified = await execute(snapshot, secrets, body, job, {
        mode: 'verify',
        dependencies,
      })
      check(!!verified.level, kind + ' verification level')
      check(
        !received
          .slice(before)
          .some(
            (r) =>
              r.target.includes('SendMessage') ||
              r.target.includes('PutEvents') ||
              r.target.endsWith(':publish') ||
              r.target.includes('/messages'),
          ),
        kind + ' verify never publishes',
      )
      const result = await execute(snapshot, secrets, body, job, {
        dependencies,
      })
      check(
        result.outcome === 'delivered',
        kind + ' accepted actual local request',
      )
    }
    const sqs = received.find((r) => r.target.includes('SendMessage'))
    check(sqs.data.MessageGroupId === body.device_id, 'FIFO device grouping')
    check(
      sqs.data.MessageDeduplicationId === job.id,
      'FIFO stable delivery dedup',
    )
    check(
      sqs.headers.authorization.startsWith('AWS4-HMAC-SHA256'),
      'official SDK signed SQS request',
    )
    check(
      JSON.parse(sqs.data.MessageBody).data.count === body.payload.count,
      '64-bit exact string preserved through cloud message',
    )
    const pub = received.find((r) => r.target.endsWith(':publish'))
    check(
      JSON.parse(Buffer.from(pub.data.messages[0].data, 'base64')).event_id ===
        body.id,
      'Pub/Sub exact event identity',
    )
    check(
      pub.data.messages[0].attributes.struct_delivery_id === job.id,
      'Pub/Sub delivery metadata',
    )
    const eb = cases[2]
    mode = 'entry_throttled'
    check(
      (
        await execute(
          { kind: eb[0], config: eb[1], mapping },
          eb[2],
          body,
          job,
          { dependencies },
        )
      ).outcome === 'retry',
      'HTTP 200 entry throttling is not success',
    )
    mode = 'entry_denied'
    check(
      (
        await execute(
          { kind: eb[0], config: eb[1], mapping },
          eb[2],
          body,
          job,
          { dependencies },
        )
      ).outcome === 'dead',
      'HTTP 200 entry denial is permanent',
    )
    mode = 'bad_ack'
    const pubcase = cases[4]
    check(
      (
        await execute(
          { kind: pubcase[0], config: pubcase[1], mapping },
          pubcase[2],
          body,
          job,
          { dependencies },
        )
      ).outcome === 'dead',
      'missing publication ID rejected',
    )
    mode = '503'
    for (const [kind, config, secrets] of cases)
      check(
        (
          await execute({ kind, config, mapping }, secrets, body, job, {
            dependencies,
          })
        ).outcome === 'retry',
        kind + ' transient failure',
      )
    mode = '401'
    for (const [kind, config, secrets] of cases)
      check(
        (
          await execute({ kind, config, mapping }, secrets, body, job, {
            dependencies,
          })
        ).outcome === 'dead',
        kind + ' credential failure',
      )
    mode = 'success'
    // Real encrypted gateway -> atomic fanout -> shared lease -> adapter HTTP -> finish RPC.
    f = await fixture()
    await f.db.exec(
      'update delivery_pipeline_settings set enabled=true;update integration_settings set enabled=true',
    )
    const originalFrom = f.adapter.from.bind(f.adapter),
      adapter = {
        ...f.adapter,
        async rpc(name,args){if(name!=="finish_integration_delivery")return f.adapter.rpc(name,args);try{const keys=Object.keys(args);return {data:await f.scalar(`select finish_integration_delivery(${keys.map((k,i)=>`${k}=>$${i+1}`).join(",")})`,Object.values(args))}}catch(e){return {error:{message:e.message}}}},
        from(table) {
          if (table !== 'integration_definitions') return originalFrom(table)
          const filters = []
          const query = {
            select() {
              return query
            },
            eq(k, v) {
              assert(['destination_id', 'organization_id'].includes(k))
              filters.push([k, v])
              return query
            },
            async maybeSingle() {
              return {
                data: (
                  await f.db.query(
                    `select * from integration_definitions where ${filters.map(([k], i) => `${k}=$${i + 1}`).join(' and ')}`,
                    filters.map(([, v]) => v),
                  )
                ).rows[0],
              }
            },
          }
          return query
        },
      }
    for (const [kind, config, secrets] of cases) {
      const id = crypto.randomUUID()
      await f.db.query(
        'select save_integration($1,$2,$3,$4,$5,$6,null,$7,$8,0,false)',
        [
          f.org,
          f.user,
          id,
          kind,
          kind,
          JSON.stringify(config),
          JSON.stringify(mapping),
          core.seal(secrets, f.org, id),
        ],
      )
      await f.db.query("select integration_action($1,$2,$3,1,'enable')", [
        f.org,
        f.user,
        id,
      ])
    }
    await f.ingest(0, [7, 8])
    const claims = (
      await f.db.query('select * from claim_integration_deliveries(8)')
    ).rows.filter((j) => j.integration_snapshot)
    check(
      claims.length === 5,
      'five independent adapter jobs from one ingestion transaction',
    )
    const start = performance.now()
    await Promise.all(
      claims.map((j) =>
        deliver(adapter, j, undefined, {
          pipelineV2: true,
          integrationsEnabled: true,
          integrationDependencies: dependencies,
        }),
      ),
    )
    const elapsed = performance.now() - start
    check(
      (await f.scalar(
        "select count(*)::int from webhook_deliveries where integration_snapshot is not null and status='delivered'",
      )) === 5,
      'five stored downstream successes',
    )
    check(
      (await f.scalar(
        "select count(*)::int from webhook_attempts where outcome='delivered'",
      )) === 5,
      'shared per-destination attempt history',
    )
    mode = '503'
    await f.db.exec(
      'update webhook_destination_runtime set next_dispatch_at=now()',
    )
    const second = (
      await f.db.query('select * from claim_integration_deliveries(8)')
    ).rows.find((j) => j.integration_snapshot?.kind === 'http')
    await deliver(adapter, second, undefined, {
      pipelineV2: true,
      integrationsEnabled: true,
      integrationDependencies: dependencies,
    })
    check(
      (await f.scalar('select status from webhook_deliveries where id=$1', [
        second.id,
      ])) === 'pending',
      'adapter transient response uses durable retry',
    )
    mode = 'success'
    await f.db.query(
      'update webhook_deliveries set next_attempt_at=now() where id=$1',
      [second.id],
    )
    await f.db.exec(
      'update webhook_destination_runtime set next_dispatch_at=now()',
    )
    const retry = (
      await f.db.query('select * from claim_integration_deliveries(8)')
    ).rows.find((j) => j.id === second.id)
    await deliver(adapter, retry, undefined, {
      pipelineV2: true,
      integrationsEnabled: true,
      integrationDependencies: dependencies,
    })
    check(
      (await f.scalar('select status from webhook_deliveries where id=$1', [
        second.id,
      ])) === 'delivered',
      'recovered provider records success under original identity',
    )
    fs.mkdirSync('docs/phase-7/evidence', { recursive: true })
    fs.writeFileSync(
      'docs/phase-7/evidence/contracts.json',
      JSON.stringify(
        {
          passed,
          timestamp: new Date().toISOString(),
          requests: received.length,
          parallel_five_dispatch_ms: elapsed,
          boundary:
            'Real HTTP loopback contract receiver; AWS official SDK encoding/signing; local RSA OAuth and SAS verification; no live cloud IAM or managed emulator',
          implementations: JSON.parse(
            fs.readFileSync('tcp-server/package.json'),
          ).dependencies,
        },
        null,
        2,
      ),
    )
    console.log(
      `PASS ${passed} local adapter contract and gateway-to-worker checks`,
    )
  } finally {
    await f?.db.close()
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
