/**
 * dummy-device.js — Protocol v2 simulator with HMAC-authenticated frames.
 *
 *   KEY_ID=xxxxxxxxxxxxxxxx API_SECRET=64hex node dummy-device.js
 *   TRANSPORT=udp KEY_ID=… API_SECRET=… node dummy-device.js
 */
const net = require('net')
const dgram = require('dgram')
const crypto = require('crypto')
const path = require('path')
const tcpRoot = path.join(__dirname, 'tcp-server')

require(path.join(tcpRoot, 'node_modules', 'dotenv')).config({
  path: path.join(tcpRoot, '.env'),
})

const { createClient } = require(path.join(tcpRoot, 'node_modules', '@supabase/supabase-js'))
const { encryptPayload } = require(path.join(tcpRoot, 'crypto'))
const { prependTimestamp } = require(path.join(tcpRoot, 'replay'))
const { buildTelemetryFrame } = require(path.join(tcpRoot, 'protocol'))
const { decryptSecret } = require(path.join(tcpRoot, 'auth'))

const args = new Set(process.argv.slice(2))
const FORCE_ENCRYPT = args.has('--encrypt') || args.has('-e')
const FORCE_PLAIN = args.has('--plain') || args.has('-p')
const FORCE_UDP = args.has('--udp') || process.env.TRANSPORT === 'udp'

const HOST = process.env.HOST || '127.0.0.1'
const TCP_PORT = Number(process.env.PORT || process.env.TCP_PORT || 8080)
const UDP_PORT = Number(process.env.UDP_PORT || 8081)
const KEY_ID = process.env.KEY_ID || process.env.API_KEY || ''
const API_SECRET = process.env.API_SECRET || ''
const SCHEMA_VERSION = Number(process.env.SCHEMA_VERSION || 1)

async function lookupDevice(keyId) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase
    .from('devices')
    .select('id, name, key_id, api_secret_encrypted, encryption_enabled, encryption_key, schemas(version)')
    .eq('key_id', keyId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

function resolveMode(device) {
  if (FORCE_PLAIN) return { enabled: false, key: null }
  if (device?.encryption_enabled) {
    if (!device.encryption_key) {
      throw new Error(`Device "${device.name}" has ChaCha ON but no encryption_key`)
    }
    return { enabled: true, key: device.encryption_key }
  }
  if (FORCE_ENCRYPT) {
    const key = process.env.ENCRYPTION_KEY || device?.encryption_key
    if (!key) throw new Error('Forced encrypt but no ENCRYPTION_KEY')
    return { enabled: true, key }
  }
  return { enabled: false, key: null }
}

function sendTcp(buf, mode, version) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: TCP_PORT }, () => {
      socket.write(buf)
      console.log(
        `[dummy-device] fired ${buf.length}B → ${HOST}:${TCP_PORT} TCP (v2 ${mode}, schema v${version})`,
      )
      console.log(`[dummy-device] hex: ${buf.toString('hex')}`)
      setTimeout(() => socket.end(), 500)
    })
    socket.on('error', (err) => {
      console.error(`[dummy-device] TCP error: ${err.message}`)
      reject(err)
    })
    socket.on('close', () => {
      console.log('[dummy-device] TCP connection closed')
      resolve()
    })
  })
}

function sendUdp(buf, mode, version) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    socket.send(buf, UDP_PORT, HOST, (err) => {
      if (err) {
        console.error(`[dummy-device] UDP error: ${err.message}`)
        socket.close()
        reject(err)
        return
      }
      console.log(
        `[dummy-device] fired ${buf.length}B → ${HOST}:${UDP_PORT} UDP (v2 ${mode}, schema v${version})`,
      )
      console.log(`[dummy-device] hex: ${buf.toString('hex')}`)
      socket.close()
      resolve()
    })
  })
}

async function main() {
  let device = null
  try {
    device = await lookupDevice(KEY_ID)
  } catch (err) {
    console.warn(`[dummy-device] lookup failed: ${err.message}`)
  }

  const secret =
    API_SECRET ||
    (device?.api_secret_encrypted ? decryptSecret(device.api_secret_encrypted) : '')
  if (!KEY_ID || !secret) {
    throw new Error('Set KEY_ID and API_SECRET (from device create/rotate response)')
  }

  const enc = resolveMode(device)
  const schemaRel = device?.schemas
  const tip = Array.isArray(schemaRel) ? schemaRel[0] : schemaRel
  const version = Number(process.env.SCHEMA_VERSION) || Number(tip?.version) || SCHEMA_VERSION

  const packed = Buffer.alloc(9)
  packed.writeFloatLE(60.5, 0)
  packed.writeFloatLE(65.2, 4)
  packed.writeUInt8(1, 8)

  const payload = enc.enabled
    ? encryptPayload(prependTimestamp(packed), enc.key)
    : packed

  const nonce = crypto.randomBytes(12)
  const timestampSec = Math.floor(Date.now() / 1000)
  const buf = buildTelemetryFrame({
    keyId: KEY_ID,
    schemaVersion: version,
    timestampSec,
    nonce,
    payload,
    secret,
  })

  const mode = enc.enabled ? 'ChaCha20' : 'plaintext'
  if (FORCE_UDP) {
    await sendUdp(buf, mode, version)
  } else {
    await sendTcp(buf, mode, version)
  }
}

main().catch((err) => {
  console.error(`[dummy-device] ${err.message}`)
  process.exit(1)
})
