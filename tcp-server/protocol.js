/**
 * Struct Protocol v2 wire format.
 *
 * Telemetry uplink:
 *   [1B protocol=2][16B key_id][1B schema_version][4B unix_ts][12B nonce][payload][32B hmac]
 *
 * ACK uplink (schema_version = 0):
 *   [1B protocol=2][16B key_id][1B 0][16B command_id][1B result_code][32B hmac]
 */
const { frameMac } = require('./auth')

const PROTOCOL_V2 = 2
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
  if (protocol !== PROTOCOL_V2) return null
  if (buf.length < 1 + KEY_ID_LEN + SCHEMA_VERSION_LEN) return null

  const keyId = buf.subarray(1, 1 + KEY_ID_LEN).toString('ascii')
  const schemaVersion = buf.readUInt8(1 + KEY_ID_LEN)
  return { protocol, keyId, schemaVersion }
}

function splitAuthenticatedFrame(buf) {
  if (buf.length < V2_ACK_LEN + HMAC_LEN) {
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
}) {
  const body = Buffer.alloc(V2_HEADER_LEN + payload.length)
  body.writeUInt8(PROTOCOL_V2, 0)
  body.write(keyId, 1, KEY_ID_LEN, 'ascii')
  body.writeUInt8(schemaVersion & 0xff, 1 + KEY_ID_LEN)
  body.writeUInt32LE(timestampSec >>> 0, 1 + KEY_ID_LEN + SCHEMA_VERSION_LEN)
  nonce.copy(body, 1 + KEY_ID_LEN + SCHEMA_VERSION_LEN + TIMESTAMP_LEN)
  payload.copy(body, V2_HEADER_LEN)
  const mac = frameMac(secret, body)
  return Buffer.concat([body, mac])
}

function buildAckFrame({ keyId, commandId, resultCode, secret }) {
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

module.exports = {
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
