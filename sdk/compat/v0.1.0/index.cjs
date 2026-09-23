const dgram = require('node:dgram')
const { randomBytes, randomInt, createCipheriv, createHmac, createHash } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { buildTelemetryFrame, verifyTelemetryReceipt } = require('./protocol.cjs')

function buildFrame({ keyId, apiSecret, schemaVersion, payload, confirmed = false, encryptionKey, eventId,
  timestampSec = Math.floor(Date.now() / 1000), nonce = randomBytes(12) }) {
  if (!/^[a-fA-F0-9]{64}$/.test(apiSecret || '')) throw new Error('apiSecret must be 64 hex characters (used as ASCII)')
  if (typeof confirmed !== 'boolean') throw new Error('confirmed must be boolean')
  if (!Buffer.isBuffer(payload) || !payload.length) throw new Error('payload must be a nonempty Buffer')
  if (eventId) {
    if (!confirmed || !Buffer.isBuffer(eventId) || eventId.length !== 16) throw new Error('Event ID requires confirmed mode and 16 bytes')
    payload = Buffer.concat([eventId,payload])
  }
  if (payload.length > 1334 - (encryptionKey ? 32 : 0)) throw new Error('Frame exceeds 1400 bytes')
  let region = payload
  if (encryptionKey) {
    if (!/^[a-fA-F0-9]{64}$/.test(encryptionKey)) throw new Error('encryptionKey must be 64 hex characters')
    const encNonce = randomBytes(12)
    const plaintext = Buffer.alloc(4 + payload.length)
    plaintext.writeUInt32LE(timestampSec, 0); payload.copy(plaintext, 4)
    const cipher = createCipheriv('chacha20-poly1305', Buffer.from(encryptionKey, 'hex'), encNonce, { authTagLength: 16 })
    region = Buffer.concat([encNonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  }
  const frame = buildTelemetryFrame({ keyId, schemaVersion, timestampSec, nonce, payload: region, secret: apiSecret, confirmed })
  if (eventId) { frame[0]=4; createHmac('sha256',apiSecret).update(frame.subarray(0,-32)).digest().copy(frame,frame.length-32) }
  return frame
}

/** One in-flight frame per client. UDP storage receipt is opt-in; send-once has
 * no receipt wait. The budget includes DNS/connect and all retry waits. */
class StructClient {
  constructor({ host, port = 8081, keyId, apiSecret, encryptionKey }) {
    if (typeof host !== 'string' || !host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid UDP endpoint')
    this.options = { host, port, keyId, apiSecret, encryptionKey }
    this.busy = false
  }
  async send(schemaVersion, payload, { confirmed = false, maxRetries = 1, retryMs = 3000, budgetMs = 7500, eventId } = {}) {
    if (this.busy) throw new Error('A packet is already in flight')
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3 ||
        !Number.isInteger(retryMs) || retryMs < 1000 || retryMs > 30000 ||
        !Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 30000) throw new Error('Invalid delivery budget')
    const frame = buildFrame({ ...this.options, schemaVersion, payload, confirmed, eventId })
    this.busy = true
    try {
      return await new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4')
        const start = performance.now()
        let done = false, attempts = 0, retryTimer
        const budgetTimer = setTimeout(() => finish({ status: 'unknown', attempts }), budgetMs)
        const finish = (result, error) => {
          if (done) return
          done = true; clearTimeout(budgetTimer); clearTimeout(retryTimer)
          try { socket.close() } catch { /* connect may not have completed */ }
          if (error) reject(error); else resolve({ ...result, packet_id: createHash('sha256').update(frame).digest('hex'), elapsedMs: Math.round(performance.now() - start) })
        }
        const transmit = () => {
          if (done) return
          attempts++
          socket.send(frame, (error) => {
            if (done) return
            if (error) return finish({ status: 'unknown', attempts }, attempts === 1 ? error : undefined)
            if (!confirmed) return finish({ status: 'sent', attempts })
            if (attempts <= maxRetries) {
              const wait = retryMs * 2 ** (attempts - 1) + randomInt(Math.floor(retryMs / 4) + 1)
              retryTimer = setTimeout(transmit, wait)
            }
          })
        }
        socket.on('error', (error) => finish({ status: 'unknown', attempts }, attempts ? undefined : error))
        socket.on('message', (receipt) => {
          if (!done && confirmed && verifyTelemetryReceipt(receipt, frame.subarray(-32), this.options.apiSecret)) {
            finish({ status: 'committed', duplicate: receipt[36] === 1, attempts })
          }
        })
        socket.connect(this.options.port, this.options.host, transmit)
      })
    } finally { this.busy = false }
  }
}
module.exports = { StructClient, buildFrame, verifyTelemetryReceipt }
