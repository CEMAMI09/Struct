/**
 * dummy-device.js — simulates an ESP32 sending a packed LE struct over TCP.
 *
 * Frame layout (25 bytes, no padding):
 *   [0..15]  api_key   utf8  (16 B)
 *   [16..19] temp      float32 LE  = 72.5
 *   [20..23] humidity  float32 LE  = 45.2
 *   [24]     is_active uint8       = 1
 *
 * Matches schema:
 *   [{"name":"temp","type":"float32"},{"name":"humidity","type":"float32"},{"name":"is_active","type":"boolean"}]
 */

const net = require('net')

const HOST = '127.0.0.1'
const PORT = 8080
const API_KEY = '93syb4szgfq3q76s'

const buf = Buffer.alloc(25)
buf.write(API_KEY, 0, 16, 'utf8')
buf.writeFloatLE(72.5, 16)
buf.writeFloatLE(45.2, 20)
buf.writeUInt8(1, 24)

const socket = net.createConnection({ host: HOST, port: PORT }, () => {
  socket.write(buf)
  console.log(`[dummy-device] fired ${buf.length} bytes → ${HOST}:${PORT}`)
  console.log(`[dummy-device] hex: ${buf.toString('hex')}`)

  setTimeout(() => {
    socket.end()
  }, 500)
})

socket.on('error', (err) => {
  console.error(`[dummy-device] connection error: ${err.message}`)
  console.error('[dummy-device] is tcp-server running on :8080?')
  process.exit(1)
})

socket.on('close', () => {
  console.log('[dummy-device] connection closed')
})
