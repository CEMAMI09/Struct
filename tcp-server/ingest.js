const { createHash } = require('crypto')
/**
 * Transport-neutral Protocol v2 frame processor.
 * Used by both TCP and UDP listeners.
 */
const { parsePayload, schemaByteLength } = require('./parser-native')
const { decryptPayload, encryptedFrameLength } = require('./crypto')
const { stripAndValidateTimestamp } = require('./replay')
const { decryptSecret, verifyFrameMac } = require('./auth')
const {
  lookupProfileByFleetKeyId,
  getProfileSecret,
  resolveDeviceFromFleetPayload,
} = require('./zeroTouch')
const {
  PROTOCOL_CONFIRMED,
  buildTelemetryReceipt,
  V2_HEADER_LEN,
  TIMESTAMP_LEN,
  parseV2Header,
  splitAuthenticatedFrame,
  parseAckBody,
} = require('./protocol')

const REPLAY_SKEW_SEC = Number(process.env.TCP_REPLAY_SKEW_SEC || 60)
const MAX_FRAME_BYTES = Number(process.env.MAX_FRAME_BYTES || 1400)

/** @type {Map<string, string>} */
const secretCache = new Map()

/**
 * @typedef {{
 *   transport: 'tcp' | 'udp',
 *   supabase: import('@supabase/supabase-js').SupabaseClient,
 *   onTelemetryDeliver?: (deviceId: string, device: object) => Promise<void> | void,
 * }} TransportContext
 */

function getDeviceSecret(device) {
  if (!device.api_secret_encrypted) {
    throw new Error(
      `Device "${device.name}" is missing Protocol v2 credentials — rotate keys in dashboard`,
    )
  }
  const cached = secretCache.get(device.id)
  if (cached?.ciphertext === device.api_secret_encrypted) return cached.secret
  const secret = decryptSecret(device.api_secret_encrypted)
  if (secretCache.size >= 4096) secretCache.delete(secretCache.keys().next().value)
  secretCache.set(device.id, { ciphertext: device.api_secret_encrypted, secret })
  return secret
}

async function lookupDeviceByKeyId(supabase, keyId) {
  const { data: device, error } = await supabase
    .from('devices')
    .select(
      'id, name, key_id, api_secret_encrypted, user_id, organization_id, debug_trace_until, encryption_enabled, encryption_key, schemas(version, schema_definition)',
    )
    .eq('key_id', keyId)
    .maybeSingle()

  if (error) throw new Error(`Device lookup failed: ${error.message}`)
  return device
}

async function resolveSchemaDefinition(supabase, device, schemaVersion) {
  try {
    const { data: row, error } = await supabase
      .from('schema_versions')
      .select('schema_definition, version')
      .eq('device_id', device.id)
      .eq('version', schemaVersion)
      .maybeSingle()

    if (!error && row?.schema_definition && Array.isArray(row.schema_definition)) {
      return row.schema_definition
    }

    if (error && !/schema_versions|does not exist|relation/i.test(error.message)) {
      throw new Error(`Schema version lookup failed: ${error.message}`)
    }
  } catch (err) {
    if (!/schema_versions|does not exist|relation/i.test(err.message || '')) {
      throw err
    }
  }

  const schemaRel = device.schemas
  const current = Array.isArray(schemaRel) ? schemaRel[0] : schemaRel
  if (!current || !Array.isArray(current.schema_definition)) {
    return null
  }

  const tipVersion = Number(current.version) || 1
  if (tipVersion === schemaVersion || (!current.version && schemaVersion === 1)) {
    return current.schema_definition
  }

  return null
}

function plaintextLenForSchema(schemaDef, encryptionEnabled) {
  const structLen = schemaByteLength(schemaDef)
  return encryptionEnabled ? TIMESTAMP_LEN + structLen : structLen
}

function payloadRegionLength(device, schemaDef) {
  const plain = plaintextLenForSchema(schemaDef, !!device.encryption_enabled)
  if (device.encryption_enabled) {
    return encryptedFrameLength(plain)
  }
  return plain
}

async function storeTelemetry(supabase, deviceId, nonce, timestampSec, body, parsed, eventId, eventDigest, trace) {
  const { data, error } = await supabase.rpc(trace?.correlate ? 'ingest_traced_telemetry' : eventId ? 'ingest_queued_telemetry' : 'ingest_device_telemetry', {
    ...(eventId ? { p_event_id: `\\x${eventId.toString('hex')}`, p_event_digest: `\\x${eventDigest.toString('hex')}` } : {}),
    p_device_id: deviceId,
    p_nonce: `\\x${nonce.toString('hex')}`,
    p_frame_timestamp: new Date(timestampSec * 1000).toISOString(),
    p_frame_digest: `\\x${createHash('sha256').update(body).digest('hex')}`,
    p_parsed_json: parsed,
    p_skew_seconds: REPLAY_SKEW_SEC,
  })
  if (error) throw new Error(`Telemetry commit failed: ${error.message}`)
  if (trace?.correlate) {
    if (typeof data?.inserted !== 'boolean') throw new Error('Telemetry commit returned no status')
    trace.data.event_id=data.event_id;trace.data.replay=data.inserted?'new event':'duplicate committed event';return !data.inserted
  }
  if (typeof data !== 'boolean') throw new Error('Telemetry commit returned no status')
  return !data
}

async function handleAckFrame(supabase, device, body) {
  const { commandId, resultCode } = parseAckBody(body)
  const hex = commandId.toString('hex')
  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')

  const { data, error } = await supabase.rpc('acknowledge_pending_command', {
    p_device_id: device.id,
    p_command_id: uuid,
    p_result_code: resultCode,
  })

  if (error) {
    throw new Error(`ACK failed: ${error.message}`)
  }
  if (!data) {
    console.warn(`[struct] ACK for unknown/expired command ${uuid}`)
  } else {
    console.log(`[struct] ✓ ACK ${uuid} result=${resultCode}`)
  }
}

async function ingestTelemetryFrame(ctx, device, body) {
  const { supabase, transport, onTelemetryDeliver } = ctx
  const schemaVersion = body.readUInt8(1 + 16)
  const timestampSec = body.readUInt32LE(1 + 16 + 1)
  const nonce = body.subarray(1 + 16 + 1 + TIMESTAMP_LEN, V2_HEADER_LEN)
  const encryptedOrPlain = body.subarray(V2_HEADER_LEN)

  ctx.trace?.begin('schema')
  const schemaDef = await resolveSchemaDefinition(supabase, device, schemaVersion)
  if (!schemaDef || !Array.isArray(schemaDef) || schemaDef.length === 0) {
    throw new Error(`Device "${device.name}" has no schema for version ${schemaVersion}`)
  }

  const queued = body[0] === 4
  const expectedStruct = schemaByteLength(schemaDef) + (queued ? 16 : 0)
  const expectedPlain = plaintextLenForSchema(schemaDef, !!device.encryption_enabled) + (queued ? 16 : 0)
  let payload = encryptedOrPlain

  ctx.trace?.begin(device.encryption_enabled?'decryption':'payload')
  if (device.encryption_enabled) {
    if (!device.encryption_key) {
      throw new Error(`Device "${device.name}" has encryption enabled but no key`)
    }
    const expectedEnc = encryptedFrameLength(expectedPlain)
    if (encryptedOrPlain.length !== expectedEnc) {
      throw new Error(
        `Encrypted underrun for "${device.name}" v${schemaVersion}: got ${encryptedOrPlain.length}B, need ${expectedEnc}`,
      )
    }

    const encSlice = encryptedOrPlain.subarray(0, expectedEnc)
    const decrypted = decryptPayload(encSlice, device.encryption_key)
    if (decrypted.length !== expectedPlain) {
      throw new Error(
        `Decrypted length mismatch for "${device.name}" v${schemaVersion}: got ${decrypted.length}, need ${expectedPlain}`,
      )
    }

    const { payload: structBuf } = stripAndValidateTimestamp(
      decrypted,
      timestampSec,
      REPLAY_SKEW_SEC,
    )
    payload = structBuf
  } else if (encryptedOrPlain.length !== expectedStruct) {
    throw new Error(
      `Payload underrun for "${device.name}" v${schemaVersion}: got ${encryptedOrPlain.length} bytes, schema needs ${expectedStruct}`,
    )
  } else {
    payload = encryptedOrPlain.subarray(0, expectedStruct)
  }

  const eventId = queued ? payload.subarray(0,16) : null
  if (queued) payload = payload.subarray(16)
  ctx.trace?.begin('decoding')
  const parsed = parsePayload(payload, schemaDef)
  ctx.trace?.bytes(payload.length,!!device.encryption_enabled,queued,body[0]>=3)

  const eventDigest = queued ? createHash('sha256').update(Buffer.from([schemaVersion])).update(payload).digest() : null
  ctx.trace?.begin('storage')
  const duplicate = await storeTelemetry(supabase, device.id, nonce, timestampSec, body, parsed, eventId, eventDigest, ctx.trace)
  if(ctx.trace){ctx.trace.data.replay=duplicate?'duplicate committed event':'new event';ctx.trace.finish()}

  // The telemetry transaction enqueues webhooks via migration 022.

  if (typeof onTelemetryDeliver === 'function') {
    try {
      await onTelemetryDeliver(device.id, device)
    } catch (err) {
      console.warn(`[struct] downlink error (${transport}): ${err.message}`)
    }
  }

  return {
    device,
    parsed,
    schemaVersion,
    duplicate,
    expected: expectedStruct,
    received: payload.length,
  }
}

/**
 * Fleet / zero-touch path: Master Fleet Key → profile schema → extract device_id → register.
 */
async function ingestFleetTelemetryFrame(ctx, profile, body) {
  const { supabase, transport, onTelemetryDeliver } = ctx
  const schemaVersion = body.readUInt8(1 + 16)
  const timestampSec = body.readUInt32LE(1 + 16 + 1)
  const nonce = body.subarray(1 + 16 + 1 + TIMESTAMP_LEN, V2_HEADER_LEN)
  const encryptedOrPlain = body.subarray(V2_HEADER_LEN)

  if (schemaVersion !== 1) throw new Error('Fleet profiles currently support schema version 1 only')
  const schemaDef = Array.isArray(profile.schema_definition)
    ? profile.schema_definition
    : []
  if (!schemaDef.length) {
    throw new Error(`Profile "${profile.name}" has an empty schema`)
  }

  const expectedStruct = schemaByteLength(schemaDef)
  if (encryptedOrPlain.length !== expectedStruct) {
    throw new Error(
      `Fleet payload underrun for "${profile.name}" v${schemaVersion}: got ${encryptedOrPlain.length} bytes, schema needs ${expectedStruct}`,
    )
  }

  const structBuf = encryptedOrPlain.subarray(0, expectedStruct)
  const resolved = await resolveDeviceFromFleetPayload(supabase, profile, structBuf)
  const device = resolved.device

  if (device.encryption_enabled) {
    throw new Error('Encrypted devices require an encrypted frame with their per-device key_id')
  }

  const duplicate = await storeTelemetry(supabase, device.id, nonce, timestampSec, body, resolved.parsed)

  // The telemetry transaction enqueues webhooks via migration 022.

  if (typeof onTelemetryDeliver === 'function') {
    try {
      await onTelemetryDeliver(device.id, device)
    } catch (err) {
      console.warn(`[struct] downlink error (${transport}): ${err.message}`)
    }
  }

  return {
    device,
    parsed: resolved.parsed,
    schemaVersion,
    duplicate,
    expected: expectedStruct,
    received: structBuf.length,
    zeroTouchCreated: resolved.created,
    hardwareId: resolved.hardwareId,
    profileId: profile.id,
  }
}

/**
 * Process one complete Protocol v2 frame.
 * @param {Buffer} buf
 * @param {TransportContext} ctx
 */
async function processFrameInner(buf, ctx) {
  ctx.trace?.begin('receipt')
  if (!Buffer.isBuffer(buf) || buf.length < 1) {
    throw new Error('Empty frame')
  }
  if (buf.length > MAX_FRAME_BYTES) {
    throw new Error(`Frame too large: ${buf.length}B (max ${MAX_FRAME_BYTES})`)
  }

  const header = parseV2Header(buf)
  if (!header) {
    throw new Error('Unsupported protocol version — Protocol v2 required')
  }

  if (header.protocol >= PROTOCOL_CONFIRMED && (ctx.transport !== 'udp' || header.schemaVersion === 0)) {
    throw new Error('Protocol 3 supports UDP telemetry only')
  }
  const { body, mac } = splitAuthenticatedFrame(buf)
  function checkTimestamp() {
   ctx.trace?.begin('timestamp')
   if (header.schemaVersion !== 0) {
    const timestampSec = body.readUInt32LE(18)
    if (Math.abs(Math.floor(Date.now() / 1000) - timestampSec) > REPLAY_SKEW_SEC) {
      throw new Error('REPLAY_TIMESTAMP_SKEW')
    }
   }
  }
  ctx.trace?.begin('identity')
  const device = await lookupDeviceByKeyId(ctx.supabase, header.keyId)

  if (device) {
    if(ctx.trace){ctx.trace.device=device;ctx.trace.correlate=ctx.trace.data.mode==='local' || Date.parse(device.debug_trace_until)>Date.now()}
    ctx.trace?.begin('authentication')
    const secret = getDeviceSecret(device)
    if (!verifyFrameMac(secret, body, mac)) {
      throw new Error(`Invalid frame authentication for device "${device.name}"`)
    }

    ctx.trace?.finish()
    checkTimestamp()
    if (header.schemaVersion === 0) {
      ctx.trace?.begin('acknowledgment')
      await handleAckFrame(ctx.supabase, device, body)
      return { kind: 'ack', device }
    }

    const result = await ingestTelemetryFrame(ctx, device, body)
    return { kind: 'telemetry', ...result, receipt: header.protocol >= PROTOCOL_CONFIRMED ? buildTelemetryReceipt(mac, secret, result.duplicate) : null }
  }

  if (header.protocol === 4) throw new Error('Queued telemetry requires a per-device key')
  const profile = await lookupProfileByFleetKeyId(ctx.supabase, header.keyId)
  if (!profile) {
    throw new Error(`Unrecognized key_id: ${JSON.stringify(header.keyId)}`)
  }

  ctx.trace?.begin('authentication')
  const fleetSecret = getProfileSecret(profile, secretCache)
  if (!verifyFrameMac(fleetSecret, body, mac)) {
    throw new Error(`Invalid frame authentication for fleet profile "${profile.name}"`)
  }
  checkTimestamp()

  if (header.schemaVersion === 0) {
    throw new Error('ACK frames require a per-device key_id (not Master Fleet Key)')
  }

  ctx.trace?.begin('schema')
  const result = await ingestFleetTelemetryFrame(ctx, profile, body)
  if(ctx.trace)ctx.trace.data.scope='Fleet registration trace is partial; use a per-device key for full correlation'
  return { kind: 'telemetry', ...result, receipt: header.protocol === PROTOCOL_CONFIRMED ? buildTelemetryReceipt(mac, fleetSecret, result.duplicate) : null }
}

/**
 * Compute expected full frame length from an incomplete header buffer/header peek.
 */
async function expectedFrameLength(supabase, header) {
  if (header.schemaVersion === 0) {
    return require('./protocol').V2_ACK_LEN + require('./protocol').HMAC_LEN
  }
  const device = await lookupDeviceByKeyId(supabase, header.keyId)
  if (device) {
    const schemaDef = await resolveSchemaDefinition(supabase, device, header.schemaVersion)
    if (!schemaDef) return null
    return V2_HEADER_LEN + payloadRegionLength(device, schemaDef) + require('./protocol').HMAC_LEN + (header.protocol === 4 ? 16 : 0)
  }

  const profile = await lookupProfileByFleetKeyId(supabase, header.keyId)
  if (!profile || header.schemaVersion !== 1) return null
  const schemaDef = Array.isArray(profile.schema_definition)
    ? profile.schema_definition
    : null
  if (!schemaDef || !schemaDef.length) return null
  const structLen = schemaByteLength(schemaDef)
  return V2_HEADER_LEN + structLen + require('./protocol').HMAC_LEN
}

async function processFrame(buf, ctx) {
  const {Trace,persistTrace}=require('./trace')
  const trace=ctx.trace || new Trace(ctx.transport,buf?.length||0)
  if(Buffer.isBuffer(buf))trace.data.packet_id=createHash('sha256').update(buf).digest('hex')
  try {
    const result=await processFrameInner(buf,{...ctx,trace})
    trace.complete()
    trace.data.acknowledgment=result.receipt?'built; device receipt not observed':'not requested'
    return {...result,trace:trace.data}
  } catch(error) { trace.fail();throw error }
  finally {
    // Tracing must never gate a storage receipt. Persistence is best effort.
    if(!ctx.trace)void persistTrace(ctx.supabase,trace)
  }
}

module.exports = {
  MAX_FRAME_BYTES,
  REPLAY_SKEW_SEC,
  processFrame,
  lookupDeviceByKeyId,
  resolveSchemaDefinition,
  payloadRegionLength,
  expectedFrameLength,
  getDeviceSecret,
  secretCache,
}
