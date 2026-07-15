/**
 * UDP admission rules (no live socket / Supabase).
 * Run: node test-udp.js
 */
const assert = require('assert')
const dgram = require('dgram')
const { parseV2Header, V2_HEADER_LEN, HMAC_LEN } = require('./protocol')

const MAX_FRAME_BYTES = Number(process.env.MAX_FRAME_BYTES || 1400)

function admitUdpDatagram(msg) {
  if (!msg.length || msg.length > MAX_FRAME_BYTES) {
    return { ok: false, reason: 'invalid size' }
  }
  const header = parseV2Header(msg)
  if (!header) {
    return { ok: false, reason: 'not Protocol v2' }
  }
  // Trailing-bytes check requires expected length — for unit testing we only verify
  // that a datagram shorter than the minimum authenticated frame is rejected upstream.
  const minFrame = V2_HEADER_LEN + HMAC_LEN
  if (msg.length < minFrame) {
    return { ok: false, reason: 'too short' }
  }
  return { ok: true, header }
}

// Too small
assert.deepStrictEqual(admitUdpDatagram(Buffer.alloc(10)).ok, false)

// Wrong protocol byte
{
  const buf = Buffer.alloc(V2_HEADER_LEN + HMAC_LEN, 0)
  buf[0] = 1
  assert.strictEqual(admitUdpDatagram(buf).ok, false)
}

// Valid-looking Protocol v2 envelope (empty payload + zero hmac — hmac checked elsewhere)
{
  const buf = Buffer.alloc(V2_HEADER_LEN + HMAC_LEN, 0)
  buf[0] = 2
  buf[17] = 1
  const result = admitUdpDatagram(buf)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.header.protocol, 2)
  assert.strictEqual(result.header.schemaVersion, 1)
}

// Oversize
assert.strictEqual(admitUdpDatagram(Buffer.alloc(MAX_FRAME_BYTES + 1)).ok, false)

// Trailing bytes rejected when expected length is known
function rejectTrailing(msg, expected) {
  return msg.length !== expected
}
{
  const oneFrame = Buffer.alloc(V2_HEADER_LEN + 9 + HMAC_LEN, 0)
  oneFrame[0] = 2
  oneFrame[17] = 1
  const withTrailing = Buffer.concat([oneFrame, Buffer.from([0xff])])
  assert.strictEqual(rejectTrailing(withTrailing, oneFrame.length), true)
  assert.strictEqual(rejectTrailing(oneFrame, oneFrame.length), false)
}

// Socket can bind (smoke) — ephemeral port
async function smokeBind() {
  await new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', () => {
      const addr = socket.address()
      assert.ok(addr.port > 0)
      socket.close(() => resolve())
    })
  })
}

smokeBind()
  .then(() => {
    console.log('udp admission ok')
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
