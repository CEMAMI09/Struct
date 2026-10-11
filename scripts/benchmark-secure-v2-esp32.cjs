#!/usr/bin/env node
'use strict'
// No .env, HTTP client, production credentials, or external destination.
// Actual generated C serializers + C/mbedTLS SDK -> UDP 127.0.0.1 -> actual
// gateway processor -> actual migration/RPC logic in in-memory PostgreSQL.
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const dgram = require('node:dgram'), { once } = require('node:events')
const { execFileSync, spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto'), { registerHooks } = require('node:module')
const root = path.resolve(__dirname, '..')
const wire = require('../sdk/js/secure-v2.cjs')
const packed = require('../protocol/schema/bitpacked.cjs')
const { createDatabase } = require('../tests/database.cjs')
// Node 24's type stripping runs the real web schema generator. Resolve its
// single extensionless TS import without copying/reimplementing that generator.
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === './schemaCodegen' && context.parentURL?.endsWith('/secureV2Schema.ts')
    ? './schemaCodegen.ts' : specifier, context)
} })
const { generateV2PacketHeader } = require('../web/shared/secureV2Schema.ts')
hook.deregister()

// These overrides affect THIS disposable process only, never deployment config.
process.env.TCP_CREDENTIAL_KEY = '11'.repeat(32)
process.env.STRUCT_SECURE_V2_ENABLED = 'true'
process.env.STRUCT_SECURE_V2_MAX_FRAME_BYTES = '1200'
const { encryptSecret } = require('../tcp-server/auth')
const { processFrame } = require('../tcp-server/ingest')
const { Trace } = require('../tcp-server/trace')
const values = { temp: 23.5, humidity: 61.25, is_active: true }
// Public deterministic TEST root. Every run creates an isolated new database
// and new simulated devices. NEVER use these credentials on a real device.
const testRoot = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('hex')
const baseline = { payload: 9, protocol: 66, applicationUplink: 75, ipv4Udp: 28,
  ipv4Uplink: 103, applicationReceipt: 69, confirmedRoundTrip: 200,
  security: 'User-supplied unencrypted V1 baseline; not equivalent security' }
const schemas = [
  { name: 'original', slot: 1, encoding: 'legacy-le-v1', record_bytes: 9,
    legacy_schema_version: 1, schema_definition: [
      { name: 'temp', type: 'float32' }, { name: 'humidity', type: 'float32' },
      { name: 'is_active', type: 'boolean' }] },
  { name: 'optimized', slot: 2, encoding: 'bitpacked-v1', record_bytes: 3,
    schema_definition: [
      { name: 'temp', type: 'fixed', min: -40, max: 125, precision: 0.1 },
      { name: 'humidity', type: 'fixed', min: 0, max: 100, precision: 0.1 },
      { name: 'is_active', type: 'boolean' }] },
]
const hex = bytes => Buffer.from(bytes).toString('hex').toUpperCase().match(/../g)?.join(' ') || ''
function compileSimulator(directory, header) {
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'struct_packet.h'), header)
  const zig = process.env.STRUCT_ZIG_COMPILER, source = process.env.STRUCT_MBEDTLS_SOURCE
  let compiler = process.env.STRUCT_C_COMPILER
  if (!compiler && !zig) compiler = ['cc', 'gcc', 'clang'].find(name => spawnSync(name, ['--version'], { stdio: 'ignore' }).status === 0)
  if (!compiler && !zig) throw new Error('Install gcc/clang + mbedTLS, or set STRUCT_ZIG_COMPILER and STRUCT_MBEDTLS_SOURCE. See docs/SECURE-V2-ESP32-BENCHMARK.md.')
  const sdk = path.join(root, 'sdk/c'), output = path.join(directory, zig ? 'sensor.wasm' : process.platform === 'win32' ? 'sensor.exe' : 'sensor')
  const args = zig ? ['cc', '-target', 'wasm32-wasi'] : []
  args.push('-std=c99', '-O2', '-UNDEBUG', '-Wall', '-Wextra',
    '-I' + directory, '-I' + path.join(sdk, 'src'), '-I' + path.join(sdk, 'tests'),
    path.join(sdk, 'src/struct_sdk.c'), path.join(sdk, 'src/struct_secure_v2.c'),
    path.join(sdk, 'src/struct_v2_counter.c'), path.join(sdk, 'benchmarks/first_esp32_secure_v2.c'))
  if (source) {
    args.push('-I' + path.join(source, 'include'), '-DMBEDTLS_CONFIG_FILE="secure_v2_mbedtls_test_config.h"')
    for (const name of ['md', 'sha256', 'platform', 'platform_util', 'constant_time', 'hkdf', 'chacha20', 'poly1305', 'chachapoly']) args.push(path.join(source, 'library', name + '.c'))
  } else if (zig) throw new Error('STRUCT_MBEDTLS_SOURCE is required with Zig/WASI')
  else args.push('-lmbedcrypto')
  if (!zig) args.push('-lm')
  args.push('-o', output)
  execFileSync(zig || compiler, args, { stdio: 'inherit', timeout: 180000 })
  return { output, directory, kind: zig ? 'C/mbedTLS compiled to WASI using Zig' : 'Native host C/mbedTLS' }
}
async function runSimulator(build, id, receipt) {
  const args = [String(id), testRoot, ...(receipt ? [receipt.toString('hex')] : [])]
  let log
  if (build.output.endsWith('.wasm')) {
    const { WASI } = require('node:wasi'), output = path.join(build.directory, 'stdout.txt')
    const fd = fs.openSync(output, 'w')
    try {
      const wasi = new WASI({ version: 'preview1', args: [build.output, ...args], stdout: fd, returnOnExit: true })
      const module = await WebAssembly.compile(fs.readFileSync(build.output))
      const instance = await WebAssembly.instantiate(module, wasi.getImportObject())
      assert.equal(wasi.start(instance), 0, 'C simulator assertions failed')
    } finally { fs.closeSync(fd) }
    log = fs.readFileSync(output, 'utf8')
  } else log = execFileSync(build.output, args, { encoding: 'utf8', timeout: 30000 })
  const payload = Buffer.from(log.match(/^payload=([a-f0-9]+)$/m)?.[1] || '', 'hex')
  const frames = [...log.matchAll(/mode=(unconfirmed|confirmed)\r?\nsequence=(\d+)\r?\nframe=([a-f0-9]+)/g)]
    .map(([, mode, sequence, frame]) => ({ mode, sequence: Number(sequence), frame: Buffer.from(frame, 'hex') }))
  assert(payload.length); assert.equal(frames.length, 2)
  if (receipt) assert.match(log, /receipt_verified=1/)
  return { payload, frames }
}
function databaseAdapter(db) {
  const scalar = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0]
  return {
    from(table) {
      assert(['devices', 'secure_v2_credentials', 'secure_v2_schema_slots'].includes(table))
      const filters = [], query = { select() { return query }, eq(column, value) {
        assert(/^[a-z_]+$/.test(column)); filters.push([column, value]); return query
      }, async maybeSingle() {
        const rows = (await db.query(`select * from ${table} where ${filters.map(([c], i) => `${c}=$${i + 1}`).join(' and ')}`, filters.map(([, v]) => v))).rows
        return { data: rows[0] ?? null }
      } }; return query
    },
    async rpc(name, args) {
      assert.equal(name, 'ingest_secure_v2_telemetry')
      try { return { data: await scalar('select ingest_secure_v2_telemetry($1,$2,$3,$4,$5)',
        [args.p_wire_device_id, args.p_sequence, Buffer.from(args.p_frame_digest.slice(2), 'hex'), args.p_schema_slot, JSON.stringify(args.p_records)]) } }
      catch (error) { return { error: { message: error.message } } }
    },
  }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function deadline(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Local UDP benchmark timed out')), 10000)
  })]) } finally { clearTimeout(timer) }
}
function printReport(report) {
  const confirmed = name => report.cases.find(c => c.schema === name && c.confirmed)
  const a = confirmed('original'), b = confirmed('optimized')
  const rows = [
    ['Encoded sensor payload', baseline.payload + ' B', a.payloadBytes + ' B', b.payloadBytes + ' B'],
    ['Application uplink', baseline.applicationUplink + ' B', a.applicationUplinkBytes + ' B', b.applicationUplinkBytes + ' B'],
    ['Total UDP/IPv4 uplink (estimated)', baseline.ipv4Uplink + ' B', a.estimatedIpv4UplinkBytes + ' B', b.estimatedIpv4UplinkBytes + ' B'],
    ['Application receipt', baseline.applicationReceipt + ' B', a.applicationReceiptBytes + ' B', b.applicationReceiptBytes + ' B'],
    ['Confirmed round trip (estimated)', baseline.confirmedRoundTrip + ' B', a.estimatedTotalBytes + ' B', b.estimatedTotalBytes + ' B'],
    ['IPv4 uplink reduction vs V1', '—', a.ipv4UplinkReductionPercent.toFixed(2) + '%', b.ipv4UplinkReductionPercent.toFixed(2) + '%'],
    ['Application uplink reduction vs V1', '—', a.applicationUplinkReductionPercent.toFixed(2) + '%', b.applicationUplinkReductionPercent.toFixed(2) + '%'],
  ]
  console.log('\nOriginal V1 baseline is UNENCRYPTED; this is NOT an equivalent-security comparison.')
  const headers = ['Metric', 'Original V1', 'Secure V2 original schema', 'Secure V2 optimized schema']
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
  for (const row of [headers, ...rows]) console.log(row.map((cell, i) => cell.padEnd(widths[i])).join(' | '))
  for (const c of report.cases) {
    console.log(`\n${c.schema} / ${c.confirmed ? 'confirmed' : 'unconfirmed'}: ${c.applicationUplinkBytes} B application, ${c.estimatedIpv4UplinkBytes} B estimated IPv4 uplink, ${c.applicationReceiptBytes} B receipt, ${c.estimatedTotalBytes} B estimated total`)
    console.log(`  plaintext: ${c.payloadHex}\n  datagram:  ${c.frameHex}\n  receipt:   ${c.receiptHex || '(none)'}`)
    console.log(`  decoded: ${JSON.stringify(c.decoded)}; absolute errors: ${JSON.stringify(c.absoluteError)}`)
    for (const part of c.layout) console.log(`  bytes ${part.offset}..${part.offset + part.bytes - 1}: ${part.name} (${part.bytes} B) = ${part.hex}`)
  }
  console.log('\nOriginal plaintext offsets: 0..3 temp float32 LE; 4..7 humidity float32 LE; 8 active boolean.')
  console.log('Optimized plaintext: temp 11 bits (code 635), humidity 10 bits (code 613), active 1 bit, zero padding 2 bits; MSB first.')
  console.log('Receipt offsets: 0 control C0; 1..4 sequence BE32; 5..20 Poly1305 tag over the 5-byte header and empty ciphertext.')
  console.log('The nonce is derived (8-byte HKDF prefix + sequence BE32), not transmitted. No padding or extra HMAC. Schema slots are 1 and 2; original legacy schema version remains 1.')
  console.log('All application byte counts are measured buffers received over loopback UDP. IPv4/UDP adds an ESTIMATED 28 B per actual datagram; excludes link/radio headers, provisioning, retries and fragmentation.')
  console.log(`Verified: ${report.verification.telemetryRows} committed telemetry rows, ${report.verification.tamperedFramesRejected} tampered frames rejected; actual gateway receipts accepted by the C SDK. Fixed overhead target: ${report.verification.fixedOverheadBytes} B.`)
}
async function main() {
  const outputIndex = process.argv.indexOf('--output')
  if (process.argv.length > 2 && !(process.argv.length === 4 && outputIndex === 2)) throw new Error('Usage: node scripts/benchmark-secure-v2-esp32.cjs [--output report.json]')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-esp32-benchmark-'))
  let db, server, client
  try {
    db = await createDatabase()
    const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
    const user = '70000000-0000-0000-0000-000000000001', org = '70000000-0000-0000-0000-000000000002'
    await db.query('insert into auth.users values($1,$2)', [user, 'benchmark@example.invalid'])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
    await db.query("insert into organizations(id,name,subscription_tier) values($1,'Disposable local benchmark','pro')", [org])
    await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')", [org, user])
    const adapter = databaseAdapter(db), pending = new Map(), observed = new Map()
    server = dgram.createSocket('udp4'); client = dgram.createSocket('udp4')
    server.on('message', async (frame, remote) => {
      const key = `${frame.readUInt32BE(1)}:${frame.readUInt32BE(5)}`, task = pending.get(key)
      try {
        const result = await processFrame(frame, { transport: 'udp', supabase: adapter, trace: new Trace('udp', frame.length, 'local') })
        observed.set(key, { frame: Buffer.from(frame), result })
        if (result.receipt) await new Promise((resolve, reject) => server.send(result.receipt, remote.port, remote.address, error => error ? reject(error) : resolve()))
        task.resolve(result)
      } catch (error) { task?.reject(error) }
    })
    const receipts = new Map()
    client.on('message', receipt => receipts.get(receipt.readUInt32BE(1))?.resolve(Buffer.from(receipt)))
    server.bind(0, '127.0.0.1'); client.bind(0, '127.0.0.1')
    await Promise.all([once(server, 'listening'), once(client, 'listening')])
    const report = { format: 'struct-first-esp32-secure-v2-benchmark-v1', measuredAt: new Date().toISOString(),
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      simulation: 'Generated ESP32 C application serializers and actual C/mbedTLS SDK run on host; Node bridges exact bytes over local UDP. No ESP32 instruction/radio/flash emulation.',
      security: 'ChaCha20-Poly1305, 128-bit tag, HKDF-SHA256, normal 1200-byte maximum and 1024-sequence reservation',
      nodeVersion: process.version, testRootHex: testRoot, values, baseline, schemas,
      cases: [], generatedHeaders: {}, sourceHashes: {} }
    for (let index = 0; index < schemas.length; index++) {
      const schema = schemas[index], device = `70000000-0000-0000-0000-${String(index + 3).padStart(12, '0')}`
      const legacyId = `benchmarkkey000${index}`
      await db.query('insert into devices(id,user_id,organization_id,name,api_key,key_id,api_secret_encrypted) values($1,$2,$3,$4,$5,$5,$6)',
        [device, user, org, schema.name, legacyId, encryptSecret('22'.repeat(32))])
      if (schema.legacy_schema_version) await db.query('select publish_device_schema($1,$2,1)', [device, JSON.stringify(schema.schema_definition)])
      const credential = await scalar('select row_to_json(enroll_device_secure_v2($1,$2,$3,$4,$5,$6,false,0))',
        [device, org, encryptSecret(testRoot), testRoot.slice(-4), encryptSecret('33'.repeat(32)), createHash('sha256').update('benchmark bootstrap').digest()])
      const id = Number(credential.wire_device_id)
      await db.query('select publish_secure_v2_schema_slot($1,$2,$3,$4,$5,$6,$7,null)',
        [device, org, schema.slot, schema.encoding, JSON.stringify(schema.schema_definition), schema.record_bytes, schema.legacy_schema_version ?? null])
      const header = generateV2PacketHeader(schema)
      report.generatedHeaders[schema.name] = header
      const build = compileSimulator(path.join(temp, schema.name), header)
      report.compiler = build.kind
      const simulation = await runSimulator(build, id)
      if (schema.name === 'original') assert.equal(simulation.payload.toString('hex'), '0000bc410000754201', 'Must match the original V1 bytes exactly')
      else assert(simulation.payload.equals(Buffer.from(packed.encodePayload(values, schema.schema_definition))), 'Generated C and canonical JS packing differ')
      let actualReceipt
      for (const sample of simulation.frames) {
        const { frame, sequence, mode } = sample, confirmed = mode === 'confirmed', key = `${id}:${sequence}`
        const task = deferred(), receiptTask = deferred(); pending.set(key, task); receipts.set(sequence, receiptTask)
        // A real OS UDP datagram, carrying bytes emitted by C, not a Node estimate.
        await new Promise((resolve, reject) => client.send(frame, server.address().port, '127.0.0.1', error => error ? reject(error) : resolve()))
        const decoded = await deadline(task.promise)
        const receipt = confirmed ? await deadline(receiptTask.promise) : Buffer.alloc(0)
        assert(observed.get(key).frame.equals(frame)); assert.equal(decoded.duplicate, false)
        assert.equal(decoded.schemaVersion, schema.legacy_schema_version ?? schema.slot)
        assert.equal(Boolean(decoded.receipt), confirmed)
        assert.equal(wire.parseHeader(frame).confirmed, confirmed)
        assert(wire.decryptFrame(frame, testRoot).plaintext.equals(simulation.payload))
        const error = { temp: Math.abs(decoded.parsed.temp - values.temp), humidity: Math.abs(decoded.parsed.humidity - values.humidity) }
        assert.equal(decoded.parsed.is_active, true)
        if (schema.name === 'original') assert.deepEqual(decoded.parsed, values)
        else { assert(error.temp <= 0.050000001); assert(error.humidity <= 0.050000001) }
        const corrupt = Buffer.from(frame); corrupt[corrupt.length - 1] ^= 1
        await assert.rejects(processFrame(corrupt, { transport: 'udp', supabase: adapter }), /authentication/)
        const measured = observed.get(key).frame
        const headerBytes = wire.parseHeader(measured).aad.length
        const cipherBytes = wire.decryptFrame(measured, testRoot).plaintext.length
        const tagBytes = measured.length - headerBytes - cipherBytes
        assert.equal(measured.length - simulation.payload.length, 25)
        assert.equal(cipherBytes, simulation.payload.length); assert.equal(tagBytes, 16)
        assert.equal(receipt.length, confirmed ? wire.RECEIPT_BYTES : 0)
        if (confirmed) actualReceipt = receipt
        report.cases.push({ schema: schema.name, confirmed, wireDeviceId: id, sequence, slot: schema.slot,
          legacySchemaVersion: schema.legacy_schema_version ?? null, payloadBytes: simulation.payload.length,
          headerBytes, cipherBytes, authenticationTagBytes: tagBytes, encryptionExpansionBytes: 0,
          fixedOverheadBytes: measured.length - simulation.payload.length,
          applicationUplinkBytes: measured.length, estimatedIpv4UdpOverheadBytes: baseline.ipv4Udp,
          estimatedIpv4UplinkBytes: measured.length + baseline.ipv4Udp,
          applicationReceiptBytes: receipt.length, estimatedIpv4ReceiptBytes: confirmed ? receipt.length + baseline.ipv4Udp : 0,
          estimatedTotalBytes: measured.length + baseline.ipv4Udp + (confirmed ? receipt.length + baseline.ipv4Udp : 0),
          applicationUplinkReductionPercent: (1 - measured.length / baseline.applicationUplink) * 100,
          ipv4UplinkReductionPercent: (1 - (measured.length + baseline.ipv4Udp) / baseline.ipv4Uplink) * 100,
          payloadHex: hex(simulation.payload), frameHex: hex(measured), receiptHex: hex(receipt), decoded: decoded.parsed, absoluteError: error,
          layout: [
            { name: 'control: generation + slot + confirmed + batch', offset: 0, bytes: 1, hex: hex(measured.subarray(0, 1)) },
            { name: 'wire device ID (BE32)', offset: 1, bytes: 4, hex: hex(measured.subarray(1, 5)) },
            { name: 'sequence (BE32)', offset: 5, bytes: 4, hex: hex(measured.subarray(5, 9)) },
            { name: 'encrypted sensor payload', offset: headerBytes, bytes: cipherBytes, hex: hex(measured.subarray(headerBytes, -tagBytes)) },
            { name: 'Poly1305 authentication tag', offset: measured.length - tagBytes, bytes: tagBytes, hex: hex(measured.subarray(-tagBytes)) },
          ] })
        receipts.delete(sequence)
      }
      // Replay the identical deterministic test stream locally inside C, supplying
      // the receipt actually returned by the gateway, to exercise SDK poll/commit.
      // No second UDP transmission and no new/changed plaintext under a nonce.
      const verified = await runSimulator(build, id, actualReceipt)
      for (let i = 0; i < 2; i++) assert(verified.frames[i].frame.equals(simulation.frames[i].frame))
      assert.equal(await scalar('select count(*)::int from telemetry where device_id=$1', [device]), 2)
      const stored = (await db.query('select parsed_json from telemetry where device_id=$1', [device])).rows
      for (const row of stored) assert.deepEqual(row.parsed_json, report.cases.find(c => c.wireDeviceId === id).decoded)
    }
    report.verification = { telemetryRows: await scalar('select count(*)::int from telemetry'), tamperedFramesRejected: 4,
      gatewayAuthenticationAndDecoding: true, cSdkConfirmedReceiptsVerified: 2, fixedOverheadBytes: 25 }
    assert.equal(report.verification.telemetryRows, 4)
    for (const file of ['scripts/benchmark-secure-v2-esp32.cjs', 'sdk/c/benchmarks/first_esp32_secure_v2.c',
      'web/shared/secureV2Schema.ts', 'web/shared/schemaCodegen.ts', 'protocol/schema/bitpacked.cjs',
      'sdk/c/src/struct_secure_v2.c', 'sdk/c/src/struct_v2_counter.c', 'sdk/c/src/struct_v2_mbedtls.h',
      'tcp-server/secure-v2.js', 'supabase/migrations/033_secure_v2.sql']) {
      report.sourceHashes[file] = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
    }
    printReport(report)
    if (outputIndex !== -1) {
      const output = path.resolve(process.argv[outputIndex + 1])
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
      console.log(`\nMachine-readable report: ${output}`)
    }
  } finally {
    for (const socket of [client, server]) if (socket) await new Promise(resolve => socket.close(resolve))
    if (db) await db.close()
    const resolved = path.resolve(temp)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('struct-esp32-benchmark-')) throw new Error('Unsafe benchmark cleanup path')
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
