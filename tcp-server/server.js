if (require.main === module) require('dotenv').config()
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
  expectedFrameLength,
  MAX_FRAME_BYTES,
} = require('./ingest')
const { startUdpServer } = require('./udp')

function createTcpServer(supabase) {
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
  let boundKeyId = null
  let connectedEventSent = false

  socket.setTimeout(30_000, () => socket.destroy())
  socket.on('data', async (chunk) => {
    // EventEmitter does not await async listeners. Pause before the first await
    // so fragmented/coalesced TCP data cannot race another frame processor.
    socket.pause()
    if (buffer.length + chunk.length > 65536 + MAX_FRAME_BYTES) {
      socket.destroy()
      return
    }
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

        if (header.protocol !== 2) throw new Error('Confirmed telemetry requires UDP')
        const frameLen = await expectedFrameLength(supabase, header)
        if (!frameLen || frameLen > MAX_FRAME_BYTES) throw new Error('Unknown or oversized schema')

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

        if (boundKeyId && header.keyId !== boundKeyId) throw new Error('One key per TCP connection')
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

        if (boundDeviceId && result.device?.id !== boundDeviceId) throw new Error('One device per TCP connection')
        if (result.device && !socket.destroyed) {
          boundKeyId = header.keyId
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
            '[payload omitted]',
            `(${result.expected}B${result.device.encryption_enabled ? ', enc' : ''})`,
          )
        }
      }
    } catch (err) {
      console.error(`[struct] error from ${remote}:`, err.message)
      buffer = Buffer.alloc(0)
      socket.destroy()
    } finally {
      if (!socket.destroyed) socket.resume()
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

return { server, liveSockets, subscribeDownlinkRealtime }
}

function start() {
  require('dotenv').config()
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { server, subscribeDownlinkRealtime } = createTcpServer(supabase)
  server.listen(Number(process.env.TCP_PORT || 8080), () => {
    console.log(`[struct] TCP ingestion listening on :${server.address().port}`)
    console.log(`[struct] parser backend: ${parserSource}`)
    startRateLimitCleanup()
    subscribeDownlinkRealtime()
    startUdpServer(supabase)
    require('./outbox').startOutbox(supabase)
  })
}

module.exports = { createTcpServer }
if (require.main === module) start()
