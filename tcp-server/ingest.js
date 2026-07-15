/**
 * Transport-neutral Protocol v2 frame processor.
 * Used by both TCP and UDP listeners.
 */
const { parsePayload, schemaByteLength } = require('./parser-native')
const { decryptPayload, encryptedFrameLength } = require('./crypto')
const { dispatchWebhooks } = require('./webhooks')
const { deliverPendingDownlinks } = require('./downlinks')
const { stripAndValidateTimestamp } = require('./replay')
const { decryptSecret, verifyFrameMac } = require('./auth')
const {
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
  if (cached) return cached
  const secret = decryptSecret(device.api_secret_encrypted)
  secretCache.set(device.id, secret)
  return secret
}

async function lookupDeviceByKeyId(supabase, keyId) {
  const { data: device, error } = await supabase
    .from('devices')
    .select(
      'id, name, key_id, api_secret_encrypted, user_id, organization_id, encryption_enabled, encryption_key, schemas(version, schema_definition)',
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

async function reserveNonce(supabase, deviceId, nonce, timestampSec) {
  const frameTimestamp = new Date(timestampSec * 1000).toISOString()
  const { error } = await supabase.rpc('reserve_device_nonce', {
    p_device_id: deviceId,
    p_nonce: nonce,
    p_frame_timestamp: frameTimestamp,
    p_skew_seconds: REPLAY_SKEW_SEC,
  })

  if (error) {
    if (/REPLAY_DUPLICATE_NONCE|REPLAY_TIMESTAMP_SKEW/i.test(error.message)) {
      throw new Error(error.message)
    }
    throw new Error(`Replay reservation failed: ${error.message}`)
  }
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

  await reserveNonce(supabase, device.id, nonce, timestampSec)

  const schemaDef = await resolveSchemaDefinition(supabase, device, schemaVersion)
  if (!schemaDef || !Array.isArray(schemaDef) || schemaDef.length === 0) {
    throw new Error(`Device "${device.name}" has no schema for version ${schemaVersion}`)
  }

  const expectedStruct = schemaByteLength(schemaDef)
  const expectedPlain = plaintextLenForSchema(schemaDef, !!device.encryption_enabled)
  let payload = encryptedOrPlain

  if (device.encryption_enabled) {
    if (!device.encryption_key) {
      throw new Error(`Device "${device.name}" has encryption enabled but no key`)
    }
    const expectedEnc = encryptedFrameLength(expectedPlain)
    if (encryptedOrPlain.length < expectedEnc) {
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
  } else if (encryptedOrPlain.length < expectedStruct) {
    throw new Error(
      `Payload underrun for "${device.name}" v${schemaVersion}: got ${encryptedOrPlain.length} bytes, schema needs ${expectedStruct}`,
    )
  } else {
    payload = encryptedOrPlain.subarray(0, expectedStruct)
  }

  const parsed = parsePayload(payload, schemaDef)

  const { error: insertErr } = await supabase.from('telemetry').insert({
    device_id: device.id,
    parsed_json: parsed,
  })

  if (insertErr) {
    throw new Error(`Telemetry insert failed: ${insertErr.message}`)
  }

  await supabase
    .from('devices')
    .update({ last_seen: new Date().toISOString() })
    .eq('id', device.id)

  dispatchWebhooks(supabase, device, parsed).catch((err) => {
    console.warn(`[struct] webhook fan-out error: ${err.message}`)
  })

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
    expected: expectedStruct,
    received: payload.length,
  }
}

/**
 * Process one complete Protocol v2 frame.
 * @param {Buffer} buf
 * @param {TransportContext} ctx
 */
async function processFrame(buf, ctx) {
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

  const { body, mac } = splitAuthenticatedFrame(buf)
  const device = await lookupDeviceByKeyId(ctx.supabase, header.keyId)
  if (!device) {
    throw new Error(`Unrecognized key_id: ${JSON.stringify(header.keyId)}`)
  }

  const secret = getDeviceSecret(device)
  if (!verifyFrameMac(secret, body, mac)) {
    throw new Error(`Invalid frame authentication for device "${device.name}"`)
  }

  if (header.schemaVersion === 0) {
    await handleAckFrame(ctx.supabase, device, body)
    return { kind: 'ack', device }
  }

  const result = await ingestTelemetryFrame(ctx, device, body)
  return { kind: 'telemetry', ...result }
}

/**
 * Compute expected full frame length from an incomplete header buffer/header peek.
 */
async function expectedFrameLength(supabase, header) {
  if (header.schemaVersion === 0) {
    return require('./protocol').V2_ACK_LEN + require('./protocol').HMAC_LEN
  }
  const device = await lookupDeviceByKeyId(supabase, header.keyId)
  if (!device) return null
  const schemaDef = await resolveSchemaDefinition(supabase, device, header.schemaVersion)
  if (!schemaDef) return null
  return V2_HEADER_LEN + payloadRegionLength(device, schemaDef) + require('./protocol').HMAC_LEN
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
