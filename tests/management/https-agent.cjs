// Actual certificate-verified HTTPS + PostgreSQL-engine lifecycle + host A/B files.
// The transport fixture is not Nuxt, cloud storage, ESP flash or physical hardware.
const assert = require('node:assert/strict'),
  https = require('node:https'),
  fs = require('node:fs'),
  fsp = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  { execFileSync } = require('node:child_process'),
  { setup } = require('./fixture.cjs'),
  core = require('../../protocol/management/core.cjs'),
  {
    ReferenceABAgent,
    transport,
  } = require('../../sdk/management/node-agent.cjs')
async function run() {
  const f = await setup(),
    temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'struct-management-https-'))
  let server,
    n = 0,
    corrupt = false,
    loseHealthy = false
  const check = (v, m) => {
    assert(v, m)
    n++
  }
  try {
    const committed = await f.ingest(0)
    check(
      committed.receipt.length === 21,
      'Existing Secure V2 gateway path commits before management',
    )
    const telemetryFrameSize = f.frame(0).length
    const openssl =
        process.env.STRUCT_OPENSSL ||
        'C:/Program Files/Git/usr/bin/openssl.exe',
      keyFile = path.join(temp, 'tls.key'),
      certFile = path.join(temp, 'tls.pem')
    execFileSync(
      openssl,
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout',
        keyFile,
        '-out',
        certFile,
      ],
      { stdio: 'ignore' },
    )
    const ca = fs.readFileSync(certFile)
    server = https.createServer(
      { key: fs.readFileSync(keyFile), cert: ca },
      async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        try {
          const route = req.url
          let b = {}
          if (req.method === 'POST') {
            let size = 0,
              parts = []
            for await (const part of req) {
              size += part.length
              if (size > 24576) throw Error('Too large')
              parts.push(part)
            }
            b = JSON.parse(Buffer.concat(parts))
          }
          if (route === '/api/device-management/challenge') {
            const id = crypto.randomUUID(),
              nonce = crypto.randomBytes(32).toString('hex')
            await f.scalar('select management_challenge($1,$2,$3,$4)', [
              b.wireDeviceId,
              id,
              core.digest(Buffer.from(nonce, 'hex')),
              b.bodyHash,
            ])
            return res.end(JSON.stringify({ id, nonce }))
          }
          if (route === '/api/device-management/message') {
            const { body, hash } = core.authenticate(
              f.root,
              b.wireDeviceId,
              b.challengeId,
              b.nonce,
              b.payload,
              b.mac,
            )
            let data = body.data || {},
              download
            if (body.action === 'capabilities') data = core.capabilities(data)
            if (body.action === 'poll') {
              download = {
                id: crypto.randomUUID(),
                secret: crypto.randomBytes(32).toString('hex'),
              }
              data = {
                downloadId: download.id,
                downloadHash: core.digest(Buffer.from(download.secret, 'hex')),
              }
            }
            const r = await f.scalar(
              'select management_device($1,$2,$3,$4,$5,$6)',
              [
                b.wireDeviceId,
                b.challengeId,
                core.digest(Buffer.from(b.nonce, 'hex')),
                hash,
                body.action,
                JSON.stringify(data),
              ],
            )
            if (r.operation?.kind === 'firmware')
              Object.assign(r.operation, {
                downloadToken: `ota_${download.id}.${download.secret}`,
                downloadPath:
                  '/api/device-management/download/' + r.operation.id,
              })
            if (
              loseHealthy &&
              body.action === 'report' &&
              data.stage === 'healthy'
            ) {
              loseHealthy = false
              req.socket.destroy()
              return
            }
            return res.end(JSON.stringify(r))
          }
          if (route.startsWith('/api/device-management/download/')) {
            const token = /^Bearer ota_([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(
              req.headers.authorization || '',
            )
            if (!token) throw Error('Token required')
            await f.scalar('select management_download($1,$2,$3)', [
              token[1],
              core.digest(Buffer.from(token[2], 'hex')),
              route.split('/').at(-1),
            ])
            const image = Buffer.from(f.image)
            if (corrupt) image[100] ^= 1
            res.setHeader('Content-Type', 'application/octet-stream')
            res.setHeader('Content-Length', image.length)
            return res.end(image)
          }
          res.statusCode = 404
          res.end('{}')
        } catch (e) {
          res.statusCode = /authentication/i.test(e.message) ? 401 : 409
          res.end(JSON.stringify({ error: 'Rejected' }))
        }
      },
    )
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = 'https://127.0.0.1:' + server.address().port,
      initial = path.join(temp, 'initial.bin')
    await fsp.writeFile(initial, Buffer.alloc(512, 1))
    const options = {
      rootSecret: f.root,
      wireDeviceId: f.wireId,
      organizationId: f.org,
      stateDirectory: path.join(temp, 'agent'),
      origin,
      ca,
      publicKey: f.pair.publicKey,
      capabilities: f.capabilities,
    }
    let agent = new ReferenceABAgent(options)
    await agent.provision({ initialImage: initial })
    await agent.register()
    check(
      (await agent.runOnce()).operation === null,
      'No task before confirmation',
    )
    await assert.rejects(
      transport(origin)('/api/device-management/challenge', {
        wireDeviceId: f.wireId,
        bodyHash: '00'.repeat(32),
      }),
    )
    n++
    const r = await f.preview(f.definition)
    await f.admin('confirm', { id: r, kind: 'firmware', confirm: true })
    await f.scalar('select management_tick()')
    check(
      (await agent.runOnce()).rebootRequired,
      'Actual HTTPS binary streamed and verified',
    )
    check(
      (await f.scalar(
        'select state from device_operations where rollout_id=$1',
        [r],
      )) === 'awaiting_reboot',
      'Download is not health evidence',
    )
    agent = new ReferenceABAgent(options)
    loseHealthy = true
    await assert.rejects(agent.boot(async () => true))
    n++
    check(
      (await f.scalar(
        'select state from device_operations where rollout_id=$1',
        [r],
      )) === 'healthy',
      'Server committed healthy report before simulated lost response',
    )
    agent = new ReferenceABAgent(options)
    await agent.boot(async () => true)
    check(
      (await agent.load()).report === null,
      'Durable report retried idempotently after restart',
    )
    check(
      (await agent.load()).securityVersion === 1,
      'Validated image advances application monotonic security version',
    )
    await f.scalar('select management_tick()')
    const cfg = {
        reportIntervalSeconds: 300,
        sampleIntervalSeconds: 60,
        diagnosticLevel: 'info',
      },
      cr = await f.preview({
        kind: 'configuration',
        configuration: cfg,
        selection: { ids: [f.device] },
        wavePercentages: [100],
        manualAdvance: false,
        observationSeconds: 0,
      })
    await f.admin('confirm', { id: cr, kind: 'configuration', confirm: true })
    await f.scalar('select management_tick()')
    check(
      (await agent.runOnce()).configurationApplied,
      'Configuration persisted by instrumented agent',
    )
    agent = new ReferenceABAgent(options)
    check(
      (await agent.load()).configuration.reportIntervalSeconds === 300,
      'Configuration survives process restart',
    )
    await f.scalar('select management_tick()')
    async function release(version) {
      f.image = Buffer.from(f.image)
      f.image[200]++
      const m = {
          ...f.manifest,
          artifactId: crypto.randomUUID(),
          version,
          securityVersion: 2,
          sha256: core.digest(f.image),
        },
        signature = crypto
          .sign('sha256', core.canonical(m), f.pair.privateKey)
          .toString('base64')
      await f.admin('artifact', {
        manifest: m,
        signature,
        canonical: core.canonical(m).toString(),
      })
      await f.admin('uploaded', {
        id: m.artifactId,
        size: m.size,
        sha256: m.sha256,
      })
      await f.admin('approve', { id: m.artifactId })
      const id = await f.preview({ ...f.definition, artifactId: m.artifactId })
      await f.admin('confirm', { id, kind: 'firmware', confirm: true })
      await f.scalar('select management_tick()')
      return id
    }
    const rollback = await release('1.2.0')
    await agent.runOnce()
    check(
      (await agent.boot(async () => false)).rolledBack,
      'Rejected candidate restores old host partition',
    )
    check(
      (await agent.load()).securityVersion === 1,
      'Failed candidate does not raise anti-downgrade counter',
    )
    check(
      (await f.scalar(
        'select state from device_operations where rollout_id=$1',
        [rollback],
      )) === 'rolled_back',
      'Rollback reported after host pointer recovery',
    )
    await f.scalar('select management_tick()')
    const tamper = await release('1.3.0')
    corrupt = true
    check(
      (await agent.runOnce()).failed,
      'Tampered downloaded artifact rejected',
    )
    check(
      (await f.scalar(
        'select state from device_operations where rollout_id=$1',
        [tamper],
      )) === 'failed',
      'Integrity failure recorded',
    )
    check(
      (await agent.load()).partition === 'B',
      'Tamper did not activate inactive partition',
    )
    const bytes = Buffer.from(JSON.stringify({ action: 'poll', data: {} })),
      hash = core.digest(bytes),
      request = transport(origin, ca),
      challenge = await request('/api/device-management/challenge', {
        wireDeviceId: f.wireId,
        bodyHash: hash,
      }),
      message = {
        wireDeviceId: f.wireId,
        challengeId: challenge.id,
        nonce: challenge.nonce,
        payload: bytes.toString('base64'),
        mac: core.requestMac(
          core.managementKey(f.root, f.wireId),
          f.wireId,
          challenge.id,
          challenge.nonce,
          hash,
        ),
      }
    await request('/api/device-management/message', message)
    await assert.rejects(
      request('/api/device-management/message', message),
      /409/,
    )
    n++
    await assert.rejects(
      request('/api/device-management/message', {
        ...message,
        mac: '00'.repeat(32),
      }),
      /401/,
    )
    n++
    const after = await f.ingest(1),
      duplicate = await f.ingest(1)
    check(
      after.receipt.length === 21 && f.frame(1).length === telemetryFrameSize,
      'Management does not inflate telemetry or change commit receipts',
    )
    check(
      after.eventIds[0] === duplicate.eventIds[0],
      'Device management preserves Secure V2 idempotent telemetry identity',
    )
    await f.db.query("update devices set lifecycle='disabled' where id=$1", [
      f.device,
    ])
    await assert.rejects(agent.message('poll'), /409/)
    n++
    console.log(
      'PASS ' +
        n +
        ' verified HTTPS/host A-B/configuration/restart/replay/tamper/lifecycle checks (not physical ESP32)',
    )
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    await f.db.close()
    assert(
      path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(temp).startsWith('struct-management-https-'),
    )
    await fsp.rm(temp, { recursive: true, force: true })
  }
}
run().catch((e) => {
  console.error(e.stack)
  process.exitCode = 1
})
