/**
 * Struct TCP Ingestion Engine
 *
 * Uplink protocol:
 *   [16-byte API key (ASCII)] + [payload]
 *
 * Payload (plaintext):
 *   packed little-endian struct per schema
 *
 * Payload (ChaCha20-Poly1305 when encryption_enabled):
 *   [12-byte nonce][ciphertext][16-byte tag]
 *
 * Downlink (after successful ingest, same socket):
 *   [uint16 LE length][packed command…]  (may send multiple)
 */

require('dotenv').config()
const net = require('net')
const { createClient } = require('@supabase/supabase-js')
const { parsePayload, schemaByteLength, TYPE_SIZES } = require('./parser')
const { decryptPayload, encryptedFrameLength } = require('./crypto')
const { dispatchWebhooks } = require('./webhooks')
const { deliverPendingDownlinks } = require('./downlinks')

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

/** @type {Map<string, import('net').Socket>} */
const liveSockets = new Map()

async function lookupDevice(apiKey) {
  const { data: device, error } = await supabase
    .from('devices')
    .select(
      'id, name, api_key, user_id, encryption_enabled, encryption_key, schemas(schema_definition)',
    )
    .eq('api_key', apiKey)
    .maybeSingle()

  if (error) throw new Error(`Device lookup failed: ${error.message}`)
  return device
}

function getSchemaDef(device) {
  const schemaRel = device.schemas
  return Array.isArray(schemaRel)
    ? schemaRel[0]?.schema_definition
    : schemaRel?.schema_definition
}

function payloadRegionLength(device, schemaDef) {
  const plain = schemaByteLength(schemaDef)
  if (device.encryption_enabled) {
    return encryptedFrameLength(plain)
  }
  return plain
}

async function ingestPacket(buf, socket) {
  if (buf.length < API_KEY_LEN) {
    throw new Error(`Packet too short: ${buf.length} bytes (need ≥ ${API_KEY_LEN} for API key)`)
  }

  const apiKey = buf.subarray(0, API_KEY_LEN).toString('ascii')
  const encryptedOrPlain = buf.subarray(API_KEY_LEN)

  const device = await lookupDevice(apiKey)
  if (!device) {
    throw new Error(`Unrecognized API key: ${JSON.stringify(apiKey)}`)
  }

  const schemaDef = getSchemaDef(device)
  if (!schemaDef || !Array.isArray(schemaDef) || schemaDef.length === 0) {
    throw new Error(`Device "${device.name}" has no schema defined`)
  }

  const expectedPlain = schemaByteLength(schemaDef)
  let payload = encryptedOrPlain

  if (device.encryption_enabled) {
    if (!device.encryption_key) {
      throw new Error(`Device "${device.name}" has encryption enabled but no key`)
    }
    const expectedEnc = encryptedFrameLength(expectedPlain)
    if (encryptedOrPlain.length < expectedEnc) {
      throw new Error(
        `Encrypted underrun for "${device.name}": got ${encryptedOrPlain.length}B, need ${expectedEnc}`,
      )
    }
    payload = decryptPayload(encryptedOrPlain.subarray(0, expectedEnc), device.encryption_key)
  } else if (encryptedOrPlain.length < expectedPlain) {
    throw new Error(
      `Payload underrun for "${device.name}": got ${encryptedOrPlain.length} bytes, schema needs ${expectedPlain}`,
    )
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

  // Fan-out to destinations (non-blocking on failure)
  dispatchWebhooks(supabase, device, parsed).catch((err) => {
    console.warn(`[struct] webhook fan-out error: ${err.message}`)
  })

  // Push pending downlinks on this socket
  if (socket && !socket.destroyed) {
    liveSockets.set(device.id, socket)
    try {
      await deliverPendingDownlinks(supabase, socket, device.id)
    } catch (err) {
      console.warn(`[struct] downlink error: ${err.message}`)
    }
  }

  return { device, parsed, expected: expectedPlain, received: payload.length }
}

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`
  console.log(`[struct] connect ${remote}`)

  let buffer = Buffer.alloc(0)
  let boundDeviceId = null

  socket.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    try {
      while (buffer.length >= API_KEY_LEN) {
        const apiKey = buffer.subarray(0, API_KEY_LEN).toString('ascii')
        const device = await lookupDevice(apiKey)

        if (!device) {
          console.warn(`[struct] unknown key from ${remote}: ${JSON.stringify(apiKey)}`)
          buffer = Buffer.alloc(0)
          socket.end()
          return
        }

        boundDeviceId = device.id
        liveSockets.set(device.id, socket)

        const schemaDef = getSchemaDef(device)
        if (!schemaDef || !Array.isArray(schemaDef) || schemaDef.length === 0) {
          console.warn(`[struct] no schema for device ${device.name}`)
          buffer = Buffer.alloc(0)
          socket.end()
          return
        }

        const frameLen = API_KEY_LEN + payloadRegionLength(device, schemaDef)
        if (buffer.length < frameLen) break

        const frame = buffer.subarray(0, frameLen)
        buffer = buffer.subarray(frameLen)

        const result = await ingestPacket(frame, socket)
        console.log(
          `[struct] ✓ ${result.device.name} →`,
          JSON.stringify(result.parsed),
          `(${result.expected}B${result.device.encryption_enabled ? ', enc' : ''})`,
        )
      }
    } catch (err) {
      console.error(`[struct] error from ${remote}:`, err.message)
      buffer = Buffer.alloc(0)
    }
  })

  socket.on('error', (err) => {
    console.error(`[struct] socket error ${remote}:`, err.message)
  })

  socket.on('close', () => {
    if (boundDeviceId && liveSockets.get(boundDeviceId) === socket) {
      liveSockets.delete(boundDeviceId)
    }
    console.log(`[struct] disconnect ${remote}`)
  })
})

// Realtime: if a command is queued while a socket is live, push immediately
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
  subscribeDownlinkRealtime()
})

process.on('uncaughtException', (err) => {
  console.error('[struct] uncaughtException (kept alive):', err.message)
})

process.on('unhandledRejection', (err) => {
  console.error('[struct] unhandledRejection (kept alive):', err?.message || err)
})
