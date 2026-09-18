const assert = require('node:assert/strict')
const { createHmac, createCipheriv, createDecipheriv } = require('node:crypto')
const { buildTelemetryFrame, buildTelemetryReceipt, verifyTelemetryReceipt } = require('../js/protocol.cjs')
const { buildFrame } = require('../js/index.cjs')
const fixtures = require('./protocol-vectors.json')

for (const v of fixtures.vectors) {
  const frame = Buffer.from(v.frameHex, 'hex'), body = frame.subarray(0, -32), mac = frame.subarray(-32)
  const payload = Buffer.from(v.payloadHex, 'hex')
  assert.deepEqual(mac, createHmac('sha256', v.apiSecret).update(body).digest(), v.name)
  let region = payload
  if (v.encryptionKey) {
    const key = Buffer.from(v.encryptionKey, 'hex'), nonce = Buffer.from(v.encryptionNonceHex, 'hex')
    const plaintext = Buffer.alloc(4 + payload.length)
    plaintext.writeUInt32LE(v.timestampSec); payload.copy(plaintext, 4)
    const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
    region = Buffer.concat([nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
    const decipher = createDecipheriv('chacha20-poly1305', key, body.subarray(34, 46), { authTagLength: 16 })
    decipher.setAuthTag(body.subarray(-16))
    assert.deepEqual(Buffer.concat([decipher.update(body.subarray(46, -16)), decipher.final()]), plaintext)
  } else {
    assert.deepEqual(buildFrame({ ...v, payload, nonce: Buffer.from(v.nonceHex, 'hex'), confirmed: v.protocol === 3 }), frame)
  }
  assert.deepEqual(buildTelemetryFrame({ ...v, secret: v.apiSecret, nonce: Buffer.from(v.nonceHex, 'hex'), payload: region, confirmed: v.protocol === 3 }), frame)
  for (const [field, duplicate] of [['receiptNewHex', false], ['receiptDuplicateHex', true]]) {
    if (!v[field]) continue
    const receipt = Buffer.from(v[field], 'hex')
    assert.deepEqual(buildTelemetryReceipt(mac, v.apiSecret, duplicate), receipt)
    assert(verifyTelemetryReceipt(receipt, mac, v.apiSecret))
    for (let i = 0; i < receipt.length; i++) {
      const corrupt = Buffer.from(receipt); corrupt[i] ^= 1
      assert.equal(verifyTelemetryReceipt(corrupt, mac, v.apiSecret), false, `${v.name}: receipt byte ${i}`)
    }
    assert.equal(verifyTelemetryReceipt(receipt, Buffer.alloc(32), v.apiSecret), false)
    assert.equal(verifyTelemetryReceipt(receipt, mac, 'b'.repeat(64)), false)
    assert.equal(verifyTelemetryReceipt(receipt.subarray(1), mac, v.apiSecret), false)
  }
}
const delivery = require('./delivery-vectors.json')
const { buildCommand, verifyCommand } = require('../js/commands.cjs')
const payload = Buffer.from(delivery.payloadHex, 'hex')
assert.equal(buildFrame({ ...delivery, payload, confirmed: true,
  eventId: Buffer.from(delivery.eventIdHex, 'hex'), nonce: Buffer.from(delivery.nonceHex, 'hex') }).toString('hex'), delivery.frameHex)
const command = buildCommand({ ...delivery, secret: delivery.apiSecret, payload,
  commandId: Buffer.from(delivery.eventIdHex, 'hex'), issued: delivery.timestampSec })
assert.equal(command.toString('hex'), delivery.commandHex)
assert.deepEqual(verifyCommand(command, { keyId: delivery.keyId, secret: delivery.apiSecret, now: 1001 }).payload, payload)
console.log('Frozen v2/v3/v4 frames, signed commands and storage receipts: conformance passed')
