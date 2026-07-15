/**
 * UDP ingestion for Protocol v2 — one authenticated frame per datagram.
 *
 * Devices can wake, send a single datagram, and sleep without the TCP handshake tax.
 * Connected/disconnected webhooks are not emitted for UDP.
 */
const dgram = require('dgram')
const { checkIpConnection, checkPayloadRateLimit } = require('./rateLimit')
const {
  MAX_FRAME_BYTES,
  processFrame,
  expectedFrameLength,
} = require('./ingest')
const { parseV2Header, HMAC_LEN, V2_ACK_LEN } = require('./protocol')

const UDP_ENDPOINT_TTL_MS = Number(process.env.UDP_ENDPOINT_TTL_MS || 5 * 60_000)

/**
 * @typedef {{ address: string, port: number, expiresAt: number }} UdpEndpoint
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ port?: number }} [opts]
 */
function startUdpServer(supabase, opts = {}) {
  const port = Number(opts.port || process.env.UDP_PORT || 8081)
  const socket = dgram.createSocket('udp4')

  /** @type {Map<string, UdpEndpoint>} */
  const endpoints = new Map()

  function rememberEndpoint(deviceId, rinfo) {
    endpoints.set(deviceId, {
      address: rinfo.address,
      port: rinfo.port,
      expiresAt: Date.now() + UDP_ENDPOINT_TTL_MS,
    })
  }

  function getEndpoint(deviceId) {
    const ep = endpoints.get(deviceId)
    if (!ep) return null
    if (ep.expiresAt <= Date.now()) {
      endpoints.delete(deviceId)
      return null
    }
    return ep
  }

  socket.on('message', async (msg, rinfo) => {
    const remote = `${rinfo.address}:${rinfo.port}`
    try {
      const ipCheck = checkIpConnection(rinfo.address)
      if (!ipCheck.allowed) {
        console.warn(`[struct] UDP IP rate-limited from ${remote}`)
        return
      }

      if (!msg.length || msg.length > MAX_FRAME_BYTES) {
        console.warn(`[struct] UDP drop ${remote}: invalid size ${msg.length}`)
        return
      }

      const header = parseV2Header(msg)
      if (!header) {
        console.warn(`[struct] UDP drop ${remote}: not Protocol v2`)
        return
      }

      // Exactly one frame per datagram — reject trailing garbage.
      const expected =
        header.schemaVersion === 0
          ? V2_ACK_LEN + HMAC_LEN
          : await expectedFrameLength(supabase, header)

      if (!expected || msg.length !== expected) {
        console.warn(
          `[struct] UDP drop ${remote}: length ${msg.length} ≠ expected ${expected || '?'}`,
        )
        return
      }

      const rate = checkPayloadRateLimit(header.keyId)
      if (!rate.allowed) {
        console.warn(`[struct] UDP payload rate-limited ${remote} key=${header.keyId}`)
        return
      }

      const result = await processFrame(msg, {
        transport: 'udp',
        supabase,
        // UDP downlinks are intentionally not delivered here without an
        // authenticated downlink reply path. Endpoint is tracked for future use.
        onTelemetryDeliver: async (deviceId) => {
          rememberEndpoint(deviceId, rinfo)
        },
      })

      if (result.device) {
        rememberEndpoint(result.device.id, rinfo)
      }

      if (result.kind === 'telemetry') {
        console.log(
          `[struct] ✓ UDP ${result.device.name} v${result.schemaVersion} →`,
          JSON.stringify(result.parsed),
          `(${result.expected}B${result.device.encryption_enabled ? ', enc' : ''})`,
        )
      } else {
        console.log(`[struct] ✓ UDP ACK from ${result.device?.name || remote}`)
      }
    } catch (err) {
      console.error(`[struct] UDP error from ${remote}:`, err.message)
    }
  })

  socket.on('error', (err) => {
    console.error('[struct] UDP socket error:', err.message)
  })

  socket.bind(port, () => {
    console.log(`[struct] UDP ingestion listening on :${port}`)
    console.log('[struct] UDP: one Protocol v2 frame per datagram')
  })

  return { socket, getEndpoint, endpoints }
}

module.exports = {
  startUdpServer,
  UDP_ENDPOINT_TTL_MS,
}
