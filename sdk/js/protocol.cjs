/**
 * Struct Protocol v2 wire format.
 *
 * Telemetry uplink:
 *   [1B protocol=2][16B key_id][1B schema_version][4B unix_ts][12B nonce][payload][32B hmac]
 *
 * ACK uplink (schema_version = 0):
 *   [1B protocol=2][16B key_id][1B 0][16B command_id][1B result_code][32B hmac]
 */
const { createHmac } = require('node:crypto')
const frameMac = (secret, body) => createHmac('sha256', secret).update(body).digest()

const PROTOCOL_V2 = 2
// Same layout as v2; opts into a signed UDP storage receipt. Never auto-downgrade.
const PROTOCOL_CONFIRMED = 3
const RECEIPT_MAGIC = Buffer.from('STRA')
const RECEIPT_LEN = 69 // magic(4) + original frame HMAC(32) + status(1) + HMAC(32)
const KEY_ID_LEN = 16
const SCHEMA_VERSION_LEN = 1
const TIMESTAMP_LEN = 4
const NONCE_LEN = 12
const HMAC_LEN = 32
const COMMAND_ID_LEN = 16
const RESULT_CODE_LEN = 1

const V2_HEADER_LEN =
  1 + KEY_ID_LEN + SCHEMA_VERSION_LEN + TIMESTAMP_LEN + NONCE_LEN

const V2_ACK_LEN =
  1 + KEY_ID_LEN + SCHEMA_VERSION_LEN + COMMAND_ID_LEN + RESULT_CODE_LEN

const DOWNLINK_PROTOCOL_V2 = 2

function parseV2Header(buf) {
  if (buf.length < 1) return null
  const protocol = buf.readUInt8(0)
  if (protocol !== PROTOCOL_V2 && protocol !== PROTOCOL_CONFIRMED && protocol !== 4) return null
  if (buf.length < 1 + KEY_ID_LEN + SCHEMA_VERSION_LEN) return null

  const keyBytes = buf.subarray(1, 1 + KEY_ID_LEN)
  if (!keyBytes.every((b) => b >= 0x21 && b <= 0x7e)) return null
  const keyId = keyBytes.toString('ascii')
  const schemaVersion = buf.readUInt8(1 + KEY_ID_LEN)
  return { protocol, keyId, schemaVersion }
}

function splitAuthenticatedFrame(buf) {
  const header = parseV2Header(buf)
  const minBody = header?.schemaVersion === 0 ? V2_ACK_LEN : V2_HEADER_LEN
  if (!header || buf.length < minBody + HMAC_LEN) {
    throw new Error(`Frame too short for protocol v2: ${buf.length}B`)
  }
  const body = buf.subarray(0, buf.length - HMAC_LEN)
  const mac = buf.subarray(buf.length - HMAC_LEN)
  return { body, mac }
}

function buildTelemetryFrame({
  keyId,
  schemaVersion,
  timestampSec,
  nonce,
  payload,
  secret,
  confirmed = false,
}) {
  if (typeof keyId !== 'string' || !/^[!-~]{16}$/.test(keyId)) throw new Error('keyId must be 16 ASCII characters')
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 255) throw new Error('schemaVersion must be 1..255')
  if (!Number.isInteger(timestampSec) || timestampSec < 0 || timestampSec > 0xffffffff) throw new Error('timestampSec must be uint32')
  if (!Buffer.isBuffer(nonce) || nonce.length !== NONCE_LEN) throw new Error('nonce must be 12 bytes')
  if (!Buffer.isBuffer(payload) || !payload.length) throw new Error('payload must be a nonempty Buffer')
  const body = Buffer.alloc(V2_HEADER_LEN + payload.length)
  body.writeUInt8(confirmed ? PROTOCOL_CONFIRMED : PROTOCOL_V2, 0)
  body.write(keyId, 1, KEY_ID_LEN, 'ascii')
  body.writeUInt8(schemaVersion & 0xff, 1 + KEY_ID_LEN)
  body.writeUInt32LE(timestampSec >>> 0, 1 + KEY_ID_LEN + SCHEMA_VERSION_LEN)
  nonce.copy(body, 1 + KEY_ID_LEN + SCHEMA_VERSION_LEN + TIMESTAMP_LEN)
  payload.copy(body, V2_HEADER_LEN)
  const mac = frameMac(secret, body)
  return Buffer.concat([body, mac])
}

function buildAckFrame({ keyId, commandId, resultCode, secret }) {
  if (typeof keyId !== 'string' || !/^[!-~]{16}$/.test(keyId)) throw new Error('keyId must be 16 ASCII characters')
  if (!Buffer.isBuffer(commandId) || commandId.length !== COMMAND_ID_LEN) throw new Error('commandId must be 16 bytes')
  if (!Number.isInteger(resultCode) || resultCode < 0 || resultCode > 255) throw new Error('resultCode must be uint8')
  const body = Buffer.alloc(V2_ACK_LEN)
  body.writeUInt8(PROTOCOL_V2, 0)
  body.write(keyId, 1, KEY_ID_LEN, 'ascii')
  body.writeUInt8(0, 1 + KEY_ID_LEN)
  commandId.copy(body, 1 + KEY_ID_LEN + SCHEMA_VERSION_LEN)
  body.writeUInt8(resultCode & 0xff, V2_ACK_LEN - RESULT_CODE_LEN)
  const mac = frameMac(secret, body)
  return Buffer.concat([body, mac])
}

function parseAckBody(body) {
  if (body.length !== V2_ACK_LEN) {
    throw new Error(`Invalid ACK body length: ${body.length}`)
  }
  const commandId = body.subarray(
    1 + KEY_ID_LEN + SCHEMA_VERSION_LEN,
    1 + KEY_ID_LEN + SCHEMA_VERSION_LEN + COMMAND_ID_LEN,
  )
  const resultCode = body.readUInt8(V2_ACK_LEN - RESULT_CODE_LEN)
  return { commandId, resultCode }
}

function buildDownlinkFrame(commandId, packedHex) {
  const payload = Buffer.from(packedHex, 'hex')
  const inner = Buffer.alloc(1 + COMMAND_ID_LEN + payload.length)
  inner.writeUInt8(DOWNLINK_PROTOCOL_V2, 0)
  commandId.copy(inner, 1)
  payload.copy(inner, 1 + COMMAND_ID_LEN)
  const header = Buffer.alloc(2)
  header.writeUInt16LE(inner.length, 0)
  return Buffer.concat([header, inner])
}

function buildTelemetryReceipt(frameMacBytes, secret, duplicate = false) {
  if (!Buffer.isBuffer(frameMacBytes) || frameMacBytes.length !== 32) throw new Error('Invalid frame MAC')
  const body = Buffer.concat([RECEIPT_MAGIC, frameMacBytes, Buffer.from([duplicate ? 1 : 0])])
  return Buffer.concat([body, frameMac(secret, body)])
}

function verifyTelemetryReceipt(receipt, frameMacBytes, secret) {
  const { timingSafeEqual } = require('crypto')
  if (!Buffer.isBuffer(receipt) || receipt.length !== RECEIPT_LEN || !Buffer.isBuffer(frameMacBytes) || frameMacBytes.length !== 32) return false
  return receipt.subarray(0, 4).equals(RECEIPT_MAGIC) && receipt[36] <= 1 &&
    timingSafeEqual(receipt.subarray(4, 36), frameMacBytes) &&
    timingSafeEqual(receipt.subarray(37), frameMac(secret, receipt.subarray(0, 37)))
}

module.exports = {
  PROTOCOL_CONFIRMED,
  RECEIPT_LEN,
  buildTelemetryReceipt,
  verifyTelemetryReceipt,
  PROTOCOL_V2,
  KEY_ID_LEN,
  SCHEMA_VERSION_LEN,
  TIMESTAMP_LEN,
  NONCE_LEN,
  HMAC_LEN,
  COMMAND_ID_LEN,
  V2_HEADER_LEN,
  V2_ACK_LEN,
  DOWNLINK_PROTOCOL_V2,
  parseV2Header,
  splitAuthenticatedFrame,
  buildTelemetryFrame,
  buildAckFrame,
  parseAckBody,
  buildDownlinkFrame,
}
