/**
 * Struct TCP + UDP Ingestion Engine — Protocol v2 only.
 *
 * Telemetry uplink:
 *   [1B protocol=2][16B key_id][1B schema_version][4B unix_ts][12B nonce][payload][32B hmac]
 *
 * ACK uplink (schema_version = 0):
 *   [1B protocol=2][16B key_id][1B 0][16B command_id][1B result_code][32B hmac]
 *
 * Downlink (TCP only):
 *   [uint16 LE length][1B downlink_protocol=2][16B command_id][command bytes]
 *
 * UDP: one authenticated frame per datagram (no handshake tax).
 */

require('dotenv').config()
const net = require('net')
const { createClient } = require('@supabase/supabase-js')
const { TYPE_SIZES, parserSource } = require('./parser-native')
const { dispatchDeviceEvent } = require('./webhooks')
const { deliverPendingDownlinks } = require('./downlinks')
const {
  checkIpConnection,
  checkPayloadRateLimit,
  startRateLimitCleanup,
} = require('./rateLimit')
const {
  V2_HEADER_LEN,
  V2_ACK_LEN,
  HMAC_LEN,
  parseV2Header,
} = require('./protocol')
const {
  processFrame,
  lookupDeviceByKeyId,
  resolveSchemaDefinition,
  payloadRegionLength,
} = require('./ingest')
const { startUdpServer } = require('./udp')

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

/** @type {Map<string, import('net').Socket>} */
const liveSockets = new Map()

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

  socket.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    try {
      while (buffer.length >= V2_ACK_LEN + HMAC_LEN) {
        const header = parseV2Header(buffer)
        if (!header) {
          console.warn(`[struct] rejected legacy/plaintext frame from ${remote}`)
          buffer = Buffer.alloc(0)
          socket.end()
          return
        }

        let frameLen = V2_ACK_LEN + HMAC_LEN
        if (header.schemaVersion !== 0) {
          const device = await lookupDeviceByKeyId(supabase, header.keyId)
          if (!device) {
            console.warn(`[struct] unknown key_id from ${remote}: ${JSON.stringify(header.keyId)}`)
            buffer = Buffer.alloc(0)
            socket.end()
            return
          }

          const schemaDef = await resolveSchemaDefinition(
            supabase,
            device,
            header.schemaVersion,
          )
          if (!schemaDef || !Array.isArray(schemaDef) || schemaDef.length === 0) {
            console.warn(`[struct] no schema v${header.schemaVersion} for device ${device.name}`)
            buffer = Buffer.alloc(0)
            socket.end()
            return
          }

          frameLen = V2_HEADER_LEN + payloadRegionLength(device, schemaDef) + HMAC_LEN
        }

        if (buffer.length < frameLen) break

        const frame = buffer.subarray(0, frameLen)
        buffer = buffer.subarray(frameLen)

        const rate = checkPayloadRateLimit(header.keyId)
        if (!rate.allowed) {
          console.warn(
            `[struct] payload rate-limited ${remote} key=${header.keyId} retry~${rate.retryAfterMs}ms`,
          )
          continue
        }

        const result = await processFrame(frame, {
          transport: 'tcp',
          supabase,
          onTelemetryDeliver: async (deviceId) => {
            if (!socket.destroyed) {
              liveSockets.set(deviceId, socket)
              await deliverPendingDownlinks(supabase, socket, deviceId)
            }
          },
        })

        if (result.device) {
          boundDeviceId = result.device.id
          boundDevice = result.device
          if (!connectedEventSent) {
            connectedEventSent = true
            liveSockets.set(result.device.id, socket)
            dispatchDeviceEvent(supabase, result.device, 'device.connected').catch((err) => {
              console.warn(`[struct] connected webhook error: ${err.message}`)
            })
          }
        }

        if (result.kind === 'telemetry') {
          console.log(
            `[struct] ✓ ${result.device.name} v${result.schemaVersion} →`,
            JSON.stringify(result.parsed),
            `(${result.expected}B${result.device.encryption_enabled ? ', enc' : ''})`,
          )
        }
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
  console.log(`[struct] parser backend: ${parserSource}`)
  console.log('[struct] protocol: v2 authenticated frames only')
  startRateLimitCleanup()
  subscribeDownlinkRealtime()
  startUdpServer(supabase)
})

process.on('uncaughtException', (err) => {
  console.error('[struct] uncaughtException (kept alive):', err.message)
})

process.on('unhandledRejection', (err) => {
  console.error('[struct] unhandledRejection (kept alive):', err?.message || err)
})
