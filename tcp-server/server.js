/**
 * Struct TCP Ingestion Engine
 *
 * Protocol:
 *   [16-byte API key (ASCII)] + [packed little-endian struct payload]
 *
 * Schema types → buffer readers (LE, matching ESP32 packed structs):
 *   float32 → readFloatLE (4)
 *   int32   → readInt32LE (4)
 *   uint8   → readUInt8   (1)
 *   boolean → readUInt8   (1)  — 0 = false, non-zero = true
 */

require('dotenv').config()
const net = require('net')
const { createClient } = require('@supabase/supabase-js')
const { parsePayload, schemaByteLength, TYPE_SIZES } = require('./parser')

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

async function lookupDevice(apiKey) {
  const { data: device, error } = await supabase
    .from('devices')
    .select('id, name, api_key, schemas(schema_definition)')
    .eq('api_key', apiKey)
    .maybeSingle()

  if (error) throw new Error(`Device lookup failed: ${error.message}`)
  return device
}

async function ingestPacket(buf) {
  if (buf.length < API_KEY_LEN) {
    throw new Error(`Packet too short: ${buf.length} bytes (need ≥ ${API_KEY_LEN} for API key)`)
  }

  const apiKey = buf.subarray(0, API_KEY_LEN).toString('ascii')
  const payload = buf.subarray(API_KEY_LEN)

  const device = await lookupDevice(apiKey)
  if (!device) {
    throw new Error(`Unrecognized API key: ${JSON.stringify(apiKey)}`)
  }

  const schemaRel = device.schemas
  const schemaDef = Array.isArray(schemaRel)
    ? schemaRel[0]?.schema_definition
    : schemaRel?.schema_definition

  if (!schemaDef || !Array.isArray(schemaDef) || schemaDef.length === 0) {
    throw new Error(`Device "${device.name}" has no schema defined`)
  }

  const expected = schemaByteLength(schemaDef)
  if (payload.length < expected) {
    throw new Error(
      `Payload underrun for "${device.name}": got ${payload.length} bytes, schema needs ${expected}`,
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

  return { device, parsed, expected, received: payload.length }
}

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`
  console.log(`[struct] connect ${remote}`)

  let buffer = Buffer.alloc(0)

  socket.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    // Process complete frames: API key + one payload matching looked-up schema.
    // Devices typically send one packet per connection or one packet per write.
    // We try to parse greedily when we have at least an API key.
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

        const schemaRel = device.schemas
        const schemaDef = Array.isArray(schemaRel)
          ? schemaRel[0]?.schema_definition
          : schemaRel?.schema_definition

        if (!schemaDef || !Array.isArray(schemaDef) || schemaDef.length === 0) {
          console.warn(`[struct] no schema for device ${device.name}`)
          buffer = Buffer.alloc(0)
          socket.end()
          return
        }

        const frameLen = API_KEY_LEN + schemaByteLength(schemaDef)
        if (buffer.length < frameLen) break

        const frame = buffer.subarray(0, frameLen)
        buffer = buffer.subarray(frameLen)

        const result = await ingestPacket(frame)
        console.log(
          `[struct] ✓ ${result.device.name} →`,
          JSON.stringify(result.parsed),
          `(${result.expected}B)`,
        )
      }
    } catch (err) {
      console.error(`[struct] error from ${remote}:`, err.message)
      buffer = Buffer.alloc(0)
      // Keep socket alive for subsequent packets unless the client closes.
    }
  })

  socket.on('error', (err) => {
    console.error(`[struct] socket error ${remote}:`, err.message)
  })

  socket.on('close', () => {
    console.log(`[struct] disconnect ${remote}`)
  })
})

server.on('error', (err) => {
  console.error('[struct] server error:', err.message)
})

server.listen(PORT, () => {
  console.log(`[struct] TCP ingestion listening on :${PORT}`)
  console.log(`[struct] type sizes: ${JSON.stringify(TYPE_SIZES)}`)
})

process.on('uncaughtException', (err) => {
  console.error('[struct] uncaughtException (kept alive):', err.message)
})

process.on('unhandledRejection', (err) => {
  console.error('[struct] unhandledRejection (kept alive):', err?.message || err)
})
