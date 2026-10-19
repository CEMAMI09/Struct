'use strict'
// Instrumented host reference. File partitions simulate A/B flash; this is not
// evidence of ESP32 bootloader, power-loss or physical hardware behavior.
const fs = require('node:fs'),
  fsp = require('node:fs/promises'),
  path = require('node:path'),
  https = require('node:https'),
  crypto = require('node:crypto'),
  { pipeline } = require('node:stream/promises'),
  { Transform } = require('node:stream')
const core = require(
  fs.existsSync(path.join(__dirname, '../../protocol/management/core.cjs'))
    ? '../../protocol/management/core.cjs'
    : '../protocol/management/core.cjs',
)
async function atomic(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp',
    handle = await fsp.open(temp, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(value))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fsp.rename(temp, file)
}
function transport(origin, ca) {
  const base = new URL(origin)
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw Error('Verified HTTPS origin required')
  return async function request(route, body, headers = {}) {
    const url = new URL(route, base)
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith('/api/device-management/')
    )
      throw Error('Management origin/path rejected')
    const bytes = body ? Buffer.from(JSON.stringify(body)) : null
    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: bytes ? 'POST' : 'GET',
          ca,
          rejectUnauthorized: true,
          headers: {
            ...headers,
            ...(bytes
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': bytes.length,
                }
              : {}),
          },
          timeout: 120000,
        },
        (response) => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            response.resume()
            reject(Error('Management HTTP ' + response.statusCode))
            return
          }
          if (!bytes) {
            resolve(response)
            return
          }
          const chunks = []
          let size = 0
          response.on('data', (chunk) => {
            size += chunk.length
            if (size > 24576) {
              response.destroy(Error('Management response too large'))
              return
            }
            chunks.push(chunk)
          })
          response.once('error', reject)
          response.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString()))
            } catch (e) {
              reject(e)
            }
          })
        },
      )
      req.on('timeout', () => req.destroy(Error('Management timeout')))
      req.once('error', reject)
      req.end(bytes)
    })
  }
}
class ReferenceABAgent {
  constructor({
    rootSecret,
    wireDeviceId,
    organizationId,
    stateDirectory,
    origin,
    ca,
    publicKey,
    capabilities,
  }) {
    this.wire = wireDeviceId
    this.org = organizationId
    this.key = core.managementKey(rootSecret, wireDeviceId)
    this.fingerprint = core.digest(this.key)
    this.publicKey = publicKey
    this.capabilities = core.capabilities(capabilities)
    this.request = transport(origin, ca)
    this.directory = path.resolve(stateDirectory)
    this.file = path.join(this.directory, 'management-state.json')
  }
  async provision({ initialImage, securityVersion = 0 }) {
    await fsp.mkdir(this.directory, { recursive: true, mode: 0o700 })
    if (fs.existsSync(this.file)) throw Error('Management state already exists')
    await fsp.copyFile(
      initialImage,
      path.join(this.directory, 'A.bin'),
      fs.constants.COPYFILE_EXCL,
    )
    await atomic(this.file, {
      wire: this.wire,
      fingerprint: this.fingerprint,
      generation: 0,
      securityVersion,
      partition: 'A',
      configuration: {
        reportIntervalSeconds: 60,
        sampleIntervalSeconds: 60,
        diagnosticLevel: 'error',
      },
      pending: null,
      report: null,
    })
    return this.load()
  }
  async load() {
    const value = JSON.parse(await fsp.readFile(this.file, 'utf8'))
    if (
      value.wire !== this.wire ||
      value.fingerprint !== this.fingerprint ||
      !Number.isSafeInteger(value.generation) ||
      !Number.isSafeInteger(value.securityVersion) ||
      !['A', 'B'].includes(value.partition)
    )
      throw Error('Missing/corrupt/wrong-epoch management state')
    core.configuration(value.configuration)
    this.state = value
    return value
  }
  async save() {
    await atomic(this.file, this.state)
  }
  async message(action, data = {}) {
    const bytes = Buffer.from(JSON.stringify({ action, data })),
      hash = core.digest(bytes),
      challenge = await this.request('/api/device-management/challenge', {
        wireDeviceId: this.wire,
        bodyHash: hash,
      })
    return this.request('/api/device-management/message', {
      wireDeviceId: this.wire,
      challengeId: challenge.id,
      nonce: challenge.nonce,
      payload: bytes.toString('base64'),
      mac: core.requestMac(
        this.key,
        this.wire,
        challenge.id,
        challenge.nonce,
        hash,
      ),
    })
  }
  async register() {
    await this.load()
    return this.message('capabilities', this.capabilities)
  }
  async flush() {
    if (!this.state.report) return
    const result = await this.message('report', this.state.report)
    if (!result.recorded) throw Error('Report outcome unknown')
    this.state.report = null
    await this.save()
  }
  async record(op, stage, extra = {}) {
    this.state.report = {
      id: op.id,
      generation: op.generation,
      stage,
      ...extra,
    }
    await this.save()
    await this.flush()
  }
  async runOnce() {
    await this.load()
    await this.flush()
    if (this.state.pending) return { awaitingBootValidation: true }
    const requestedAt = Date.now(),
      result = await this.message('poll'),
      op = result.operation
    if (!op) return result
    const deadline = requestedAt + Number(op.remainingSeconds) * 1000
    if (
      !Number.isSafeInteger(op.remainingSeconds) ||
      op.remainingSeconds < 1 ||
      op.remainingSeconds > 604800 ||
      Date.now() >= deadline
    ) {
      await this.record(op, 'rejected', { category: 'execution_window_closed' })
      return { rejected: true }
    }
    if (
      !Number.isSafeInteger(op.generation) ||
      op.generation <= this.state.generation
    )
      throw Error('Stale operation; never automatically reexecute')
    if (op.kind === 'configuration') {
      let cfg
      try {
        cfg = core.configuration(op.configuration)
      } catch {
        await this.record(op, 'rejected', {
          category: 'configuration_validation',
        })
        return { rejected: true }
      }
      this.state.generation = op.generation
      this.state.configuration = cfg
      this.state.report = {
        id: op.id,
        generation: op.generation,
        stage: 'applied',
        configuration: cfg,
      }
      await this.save()
      await this.flush()
      return {
        configurationApplied: true,
        evidence: 'instrumented host configuration journal',
      }
    }
    const m = op.manifest
    try {
      const canonical = core.verifyManifest(m, op.signature, this.publicKey)
      if (
        canonical.toString() !== op.canonical ||
        m.organizationId !== this.org ||
        core.fingerprint(this.publicKey) !== op.keyFingerprint ||
        m.platform !== this.capabilities.platform ||
        m.hardwareModel !== this.capabilities.hardwareModel ||
        m.hardwareRevision !== this.capabilities.hardwareRevision ||
        m.size > this.capabilities.partitionBytes ||
        m.securityVersion < this.state.securityVersion ||
        m.minAgentVersion > this.capabilities.agentVersion ||
        m.minimumBootloaderVersion > this.capabilities.bootloaderVersion ||
        !this.capabilities.ota ||
        !this.capabilities.rollback
      )
        throw Error('Incompatible signed release')
    } catch {
      await this.record(op, 'rejected', {
        category: 'signature_compatibility_or_downgrade',
      })
      return { rejected: true }
    }
    this.state.generation = op.generation
    this.state.pending = {
      op: { ...op, downloadToken: undefined },
      previous: this.state.partition,
      candidate: this.state.partition === 'A' ? 'B' : 'A',
      stage: 'downloading',
    }
    await this.save()
    await this.record(op, 'downloading')
    const destination = path.join(
        this.directory,
        this.state.pending.candidate + '.bin',
      ),
      temp = destination + '.download'
    let received = 0,
      header = Buffer.alloc(0),markerTail=Buffer.alloc(0)
    const hash = crypto.createHash('sha256')
    try {
      const source = await this.request(op.downloadPath, null, {
        Authorization: 'Bearer ' + op.downloadToken,
      })
      await pipeline(
        source,
        new Transform({
          transform(chunk, enc, done) {
            received += chunk.length
            if (received > m.size) return done(Error('Firmware too large'))
            const inspected=Buffer.concat([markerTail,chunk]);if(inspected.includes(core.FACTORY_MARKER))return done(Error('Factory credentials forbidden'));markerTail=inspected.subarray(Math.max(0,inspected.length-core.FACTORY_MARKER.length+1));hash.update(chunk)
            if (header.length < 80)
              header = Buffer.concat([header, chunk]).subarray(0, 80)
            done(null, chunk)
          },
        }),
        fs.createWriteStream(temp, { flags: 'w', mode: 0o600 }),
      )
      if (received !== m.size || hash.digest('hex') !== m.sha256)
        throw Error('Firmware integrity rejected')
      core.validateImageHeader(header, m)
      const persisted = await fsp.open(temp, 'r+')
      try {
        await persisted.sync()
      } finally {
        await persisted.close()
      }
    } catch {
      await fsp.rm(temp, { force: true })
      this.state.pending = null
      await this.record(op, 'failed', {
        category: 'download_integrity_or_storage',
      })
      return { failed: true }
    }
    // Communication failure is uncertainty, not proof that installation failed.
    // Durable pending/report journals reconcile a lost response on the next run.
    await this.record(op, 'verified')
    await this.record(op, 'installing')
    await fsp.rename(temp, destination)
    this.state.pending.stage = 'awaiting_reboot'
    await this.save()
    await this.record(op, 'awaiting_reboot')
    if (Date.now() >= deadline) {
      this.state.pending = null
      await this.record(op, 'failed', { category: 'execution_window_closed' })
      return { failed: true }
    }
    this.state.partition = this.state.pending.candidate
    await this.save()
    return { rebootRequired: true, simulation: 'host A/B file pointer' }
  }

  async boot(validateHealth) {
    await this.load()
    await this.flush()
    if (!this.state.pending) {
      await this.flush()
      return { candidate: false }
    }
    const pending = this.state.pending,
      op = pending.op
    if (
      pending.stage !== 'awaiting_reboot' ||
      this.state.partition !== pending.candidate
    ) {
      this.state.partition = pending.previous
      this.state.pending = null
      await this.record(op, 'failed', {
        category: 'interrupted_before_activation',
      })
      return { failed: true }
    }
    await this.record(op, 'booting')
    let healthy = false
    try {
      const hash = crypto.createHash('sha256')
      let size = 0
      for await (const chunk of fs.createReadStream(
        path.join(this.directory, this.state.partition + '.bin'),
        { highWaterMark: 16384 },
      )) {
        size += chunk.length
        hash.update(chunk)
      }
      healthy =
        this.state.partition === pending.candidate &&
        size === op.manifest.size &&
        hash.digest('hex') === op.manifest.sha256 &&
        (await validateHealth())
    } catch {}
    if (!healthy) {
      this.state.partition = pending.previous
      this.state.pending = null
      await this.record(op, 'rolled_back', {
        category: 'candidate_health_rejected',
      })
      return { rolledBack: true, simulation: 'host A/B pointer recovery' }
    }
    this.state.securityVersion = Math.max(
      this.state.securityVersion,
      op.manifest.securityVersion,
    )
    this.state.pending = null
    await this.record(op, 'healthy', {
      sha256: op.manifest.sha256,
      securityVersion: op.manifest.securityVersion,
      healthValidated: true,
    })
    return { healthy: true, evidence: 'instrumented host agent claim' }
  }
}
module.exports = { ReferenceABAgent, transport, atomic }
