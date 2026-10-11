'use strict'
// BENCHMARK ONLY. Not imported by any device SDK or production ingestion path.
// A separate generation prefix makes this impossible to parse as Secure V2.
const MAGIC = Buffer.from('SLB0')
const HEADER_BYTES = 13, RECEIPT_BYTES = 9
function buildFrame({ payload, wireDeviceId = 1, sequence = 1, slot = 1, confirmed = false, batch = false }) {
  if (!Buffer.isBuffer(payload) || payload.length > 1175 || !Number.isInteger(slot) || slot < 0 || slot > 15 ||
      !Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff ||
      !Number.isInteger(wireDeviceId) || wireDeviceId < 1 || wireDeviceId > 0xffffffff ||
      typeof confirmed !== 'boolean' || typeof batch !== 'boolean') throw Error('Invalid lab plaintext frame')
  const header = Buffer.alloc(HEADER_BYTES)
  MAGIC.copy(header); header[4] = slot << 2 | (confirmed ? 2 : 0) | (batch ? 1 : 0)
  header.writeUInt32BE(wireDeviceId, 5); header.writeUInt32BE(sequence, 9)
  return Buffer.concat([header, payload])
}
function decodeFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < HEADER_BYTES || frame.length > HEADER_BYTES + 1175 ||
      !frame.subarray(0, 4).equals(MAGIC) || frame[4] > 63 || !frame.readUInt32BE(5)) throw Error('Invalid lab plaintext frame')
  return { slot: frame[4] >>> 2, confirmed: !!(frame[4] & 2), batch: !!(frame[4] & 1),
    sequence: frame.readUInt32BE(9), wireDeviceId: frame.readUInt32BE(5), plaintext: frame.subarray(HEADER_BYTES) }
}
function receipt(sequence) { const b = Buffer.alloc(RECEIPT_BYTES); b.write('SLR0'); b.writeUInt32BE(sequence, 4); b[8] = 1; return b }
module.exports = { HEADER_BYTES, RECEIPT_BYTES, buildFrame, decodeFrame, receipt }
