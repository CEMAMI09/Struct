/**
 * Struct TCP Ingestion Engine
 *
 * Uplink protocol:
 *   [16-byte API key (ASCII)] + [1-byte schema version] + [payload]
 *
 * Payload (plaintext):
 *   packed little-endian struct for that schema version
 *
 * Payload (ChaCha20-Poly1305 when encryption_enabled):
 *   [12-byte nonce][ciphertext][16-byte tag]
 *   ciphertext plaintext = [4B uint32 LE unix ts][packed struct]
 *
 * Downlink (after successful ingest, same socket):
 *   [uint16 LE length][packed command…]  (may send multiple)
 */

require('dotenv').config()
const net = require('net')
const { createClient } = require('@supabase/supabase-js')
const { parsePayload, schemaByteLength, TYPE_SIZES } = require('./parser')
const { decryptPayload, encryptedFrameLength, splitEncryptedRegion } = require('./crypto')
const { dispatchDeviceEvent, dispatchWebhooks } = require('./webhooks')
const { deliverPendingDownlinks, writeCommandFrame } = require('./downlinks')
const {
  checkIpConnection,
  checkPayloadRateLimit,
  startRateLimitCleanup,
  RATE_LIMIT_DOWNLINK_HEX,
} = require('./rateLimit')
const {
  TIMESTAMP_LEN,
  stripAndValidateTimestamp,
  rememberNonce,
} = require('./replay')

const PORT = Number(process.env.TCP_PORT || 8080)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[struct] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const API_KEY_LEN = 16
const SCHEMA_VERSION_LEN = 1
const HEADER_LEN = API_KEY_LEN + SCHEMA_VERSION_LEN

/** @type {Map<string, import('net').Socket>} */
const liveSockets = new Map()

async function lookupDevice(apiKey) {
  const { data: device, error } = await supabase
    .from('devices')
    .select(
      'id, name, api_key, user_id, organization_id, encryption_enabled, encryption_key, schemas(version, schema_definition)',
    )
    .eq('api_key', apiKey)
    .maybeSingle()

  if (error) throw new Error(`Device lookup failed: ${error.message}`)
  return device
}

/**
 * Resolve packed field list for a wire schema version byte.
 * Falls back to the current schemas row when versions history is empty
 * (or migration 004 has not been applied yet).
 */
async function resolveSchemaDefinition(device, schemaVersion) {
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

    // Missing table / RLS / not migrated yet — fall through to schemas tip
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

  // Prefer exact version match; otherwise allow v1 packets against an unversioned tip
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

async function ingestPacket(buf, socket) {
  if (buf.length < HEADER_LEN) {
    throw new Error(`Packet too short: ${buf.length} bytes (need ≥ ${HEADER_LEN} for header)`)
  }

  const apiKey = buf.subarray(0, API_KEY_LEN).toString('ascii')
  const schemaVersion = buf.readUInt8(API_KEY_LEN)
  const encryptedOrPlain = buf.subarray(HEADER_LEN)

  const device = await lookupDevice(apiKey)
  if (!device) {
    throw new Error(`Unrecognized API key: ${JSON.stringify(apiKey)}`)
  }

  const schemaDef = await resolveSchemaDefinition(device, schemaVersion)
  if (!schemaDef || !Array.isArray(schemaDef) || schemaDef.length === 0) {
    throw new Error(
      `Device "${device.name}" has no schema for version ${schemaVersion}`,
    )
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
    const { nonce } = splitEncryptedRegion(encSlice)
    const decrypted = decryptPayload(encSlice, device.encryption_key)
    if (decrypted.length !== expectedPlain) {
      throw new Error(
        `Decrypted length mismatch for "${device.name}" v${schemaVersion}: got ${decrypted.length}, need ${expectedPlain}`,
      )
    }

    const { payload: structBuf } = stripAndValidateTimestamp(decrypted)
    rememberNonce(device.id, nonce)
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

  if (socket && !socket.destroyed) {
    liveSockets.set(device.id, socket)
    try {
      await deliverPendingDownlinks(supabase, socket, device.id)
    } catch (err) {
      console.warn(`[struct] downlink error: ${err.message}`)
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

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`

  const ipCheck = checkIpConnection(socket.remoteAddress)
  if (!ipCheck.allowed) {
    console.warn(`[struct] IP rate-limited — destroying connection from ${remote}`)
    socket.destroy()
    return
  }

  console.log(`[struct] connect ${remote}`)

  let buffer = Buffer.alloc(0)
  let boundDeviceId = null
  let boundDevice = null
  let connectedEventSent = false
  /** @type {{ name: string, enc: boolean, need: number, have: number } | null} */
  let pendingFrame = null

  socket.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    try {
      while (buffer.length >= HEADER_LEN) {
        const apiKey = buffer.subarray(0, API_KEY_LEN).toString('ascii')
        const schemaVersion = buffer.readUInt8(API_KEY_LEN)

        const device = await lookupDevice(apiKey)

        if (!device) {
          console.warn(`[struct] unknown key from ${remote}: ${JSON.stringify(apiKey)}`)
          buffer = Buffer.alloc(0)
          socket.end()
          return
        }

        boundDeviceId = device.id
        boundDevice = device
        liveSockets.set(device.id, socket)
        if (!connectedEventSent) {
          connectedEventSent = true
          dispatchDeviceEvent(supabase, device, 'device.connected').catch((err) => {
            console.warn(`[struct] connected webhook error: ${err.message}`)
          })
        }

        const schemaDef = await resolveSchemaDefinition(device, schemaVersion)
        if (!schemaDef || !Array.isArray(schemaDef) || schemaDef.length === 0) {
          console.warn(
            `[struct] no schema v${schemaVersion} for device ${device.name}`,
          )
          buffer = Buffer.alloc(0)
          socket.end()
          return
        }

        const frameLen = HEADER_LEN + payloadRegionLength(device, schemaDef)
        if (buffer.length < frameLen) {
          pendingFrame = {
            name: device.name,
            enc: !!device.encryption_enabled,
            need: frameLen,
            have: buffer.length,
          }
          break
        }

        pendingFrame = null
        const frame = buffer.subarray(0, frameLen)
        buffer = buffer.subarray(frameLen)

        const rate = checkPayloadRateLimit(apiKey)
        if (!rate.allowed) {
          console.warn(
            `[struct] payload rate-limited ${remote} device=${device.name} retry~${rate.retryAfterMs}ms`,
          )
          if (!socket.destroyed) {
            writeCommandFrame(socket, RATE_LIMIT_DOWNLINK_HEX)
          }
          continue
        }

        const result = await ingestPacket(frame, socket)
        console.log(
          `[struct] ✓ ${result.device.name} v${result.schemaVersion} →`,
          JSON.stringify(result.parsed),
          `(${result.expected}B${result.device.encryption_enabled ? ', enc' : ''})`,
        )
      }
    } catch (err) {
      console.error(`[struct] error from ${remote}:`, err.message)
      buffer = Buffer.alloc(0)
      pendingFrame = null
    }
  })

  socket.on('error', (err) => {
    console.error(`[struct] socket error ${remote}:`, err.message)
  })

  socket.on('close', () => {
    if (pendingFrame && pendingFrame.have < pendingFrame.need) {
      console.warn(
        `[struct] incomplete frame from ${remote} device=${pendingFrame.name}: ` +
          `got ${pendingFrame.have}B, need ${pendingFrame.need}B` +
          (pendingFrame.enc
            ? ' (ChaCha ON in dashboard — device must send encrypted payload with timestamp)'
            : ' (ChaCha OFF — device must send plaintext packed struct)'),
      )
    }
    if (boundDeviceId && liveSockets.get(boundDeviceId) === socket) {
      liveSockets.delete(boundDeviceId)
    }
    if (boundDevice) {
      dispatchDeviceEvent(supabase, boundDevice, 'device.disconnected').catch((err) => {
        console.warn(`[struct] disconnected webhook error: ${err.message}`)
      })
    }
    console.log(`[struct] disconnect ${remote}`)
  })
})

function subscribeDownlinkRealtime() {
  const channel = supabase
    .channel('tcp-pending-commands')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'pending_commands' },
      async (payload) => {
        const row = payload.new
        if (!row || row.status !== 'pending') return
        const sock = liveSockets.get(row.device_id)
        if (!sock || sock.destroyed) return
        try {
          await deliverPendingDownlinks(supabase, sock, row.device_id)
        } catch (err) {
          console.warn(`[struct] realtime downlink failed: ${err.message}`)
        }
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[struct] listening for pending_commands (realtime)')
      }
    })

  return channel
}

server.on('error', (err) => {
  console.error('[struct] server error:', err.message)
})

server.listen(PORT, () => {
  console.log(`[struct] TCP ingestion listening on :${PORT}`)
  console.log(`[struct] type sizes: ${JSON.stringify(TYPE_SIZES)}`)
  console.log(
    `[struct] header: ${API_KEY_LEN}B api_key + ${SCHEMA_VERSION_LEN}B schema_version`,
  )
  startRateLimitCleanup()
  subscribeDownlinkRealtime()
})

process.on('uncaughtException', (err) => {
  console.error('[struct] uncaughtException (kept alive):', err.message)
})

process.on('unhandledRejection', (err) => {
  console.error('[struct] unhandledRejection (kept alive):', err?.message || err)
})
