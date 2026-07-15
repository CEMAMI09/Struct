const crypto = require('crypto')
const {
  buildTelemetryFrame,
  buildAckFrame,
  splitAuthenticatedFrame,
  parseV2Header,
} = require('./protocol')
const { frameMac, verifyFrameMac } = require('./auth')

const secret = 'a'.repeat(64)
const keyId = 'testkeyid1234567'

const nonce = crypto.randomBytes(12)
const payload = Buffer.from('0102030405', 'hex')
const frame = buildTelemetryFrame({
  keyId,
  schemaVersion: 1,
  timestampSec: Math.floor(Date.now() / 1000),
  nonce,
  payload,
  secret,
})

const header = parseV2Header(frame)
if (!header || header.keyId !== keyId) {
  throw new Error('header parse failed')
}

const { body, mac } = splitAuthenticatedFrame(frame)
if (!verifyFrameMac(secret, body, mac)) {
  throw new Error('HMAC verification failed')
}

const tampered = Buffer.from(frame)
tampered[tampered.length - 1] ^= 0xff
const tamperedBody = tampered.subarray(0, tampered.length - 32)
const tamperedMac = tampered.subarray(tampered.length - 32)
if (verifyFrameMac(secret, tamperedBody, tamperedMac)) {
  throw new Error('tampered frame should fail verification')
}

const commandId = crypto.randomBytes(16)
const ack = buildAckFrame({ keyId, commandId, resultCode: 0, secret })
const ackHeader = parseV2Header(ack)
if (!ackHeader || ackHeader.schemaVersion !== 0) {
  throw new Error('ACK header parse failed')
}

console.log('[test-protocol] ok — v2 frame build/verify')
