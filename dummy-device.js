/**
 * dummy-device.js — simulates an ESP32 sending a packed LE struct over TCP.
 *
 * Wire: [16B api_key][1B schema_version][payload]
 *
 * Auto-matches the dashboard ChaCha toggle by looking up the device
 * (uses tcp-server/.env). You can also force a mode:
 *
 *   node dummy-device.js              # auto (preferred)
 *   node dummy-device.js --encrypt    # force ChaCha ON
 *   node dummy-device.js --plain      # force plaintext
 *   API_KEY=xxxxxxxxxxxxxxxx node dummy-device.js
 */

const net = require('net')
const path = require('path')
const tcpRoot = path.join(__dirname, 'tcp-server')

require(path.join(tcpRoot, 'node_modules', 'dotenv')).config({
  path: path.join(tcpRoot, '.env'),
})

const { createClient } = require(path.join(tcpRoot, 'node_modules', '@supabase/supabase-js'))
const { encryptPayload } = require(path.join(tcpRoot, 'crypto'))
const { prependTimestamp } = require(path.join(tcpRoot, 'replay'))

const args = new Set(process.argv.slice(2))
const FORCE_ENCRYPT = args.has('--encrypt') || args.has('-e')
const FORCE_PLAIN = args.has('--plain') || args.has('-p')

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT || process.env.TCP_PORT || 8080)
const API_KEY = process.env.API_KEY || 'v3tz2m0fv57c6p05'
const SCHEMA_VERSION = Number(process.env.SCHEMA_VERSION || 1)

async function lookupDevice(apiKey) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase
    .from('devices')
    .select('id, name, encryption_enabled, encryption_key, schemas(version)')
    .eq('api_key', apiKey)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

function resolveMode(device) {
  const forcePlain =
    FORCE_PLAIN || process.env.ENCRYPTION === '0' || process.env.ENCRYPTION === 'false'
  const forceEnc =
    FORCE_ENCRYPT || process.env.ENCRYPTION === '1' || process.env.ENCRYPTION === 'true'

  if (device) {
    if (forcePlain && device.encryption_enabled) {
      throw new Error(
        `Dashboard ChaCha is ON for "${device.name}" but you forced plaintext. ` +
          `Turn ChaCha off in Schema, or run: node dummy-device.js (auto) / --encrypt`,
      )
    }
    if (forceEnc && !device.encryption_enabled) {
      throw new Error(
        `Dashboard ChaCha is OFF for "${device.name}" but you forced encrypt. ` +
          `Turn ChaCha on in Schema first, then: node dummy-device.js`,
      )
    }
  }

  if (forcePlain) {
    return { enabled: false, key: null, source: 'forced plaintext' }
  }
  if (forceEnc) {
    const key = process.env.ENCRYPTION_KEY || device?.encryption_key
    if (!key) {
      throw new Error(
        'Forced encrypt but no key — copy the 64-char key from Schema, then:\n' +
          '  ENCRYPTION_KEY=… node dummy-device.js --encrypt',
      )
    }
    return { enabled: true, key, source: 'forced encrypt' }
  }
  if (device?.encryption_enabled) {
    if (!device.encryption_key) {
      throw new Error(`Device "${device.name}" has ChaCha ON but no encryption_key in dashboard`)
    }
    return { enabled: true, key: device.encryption_key, source: 'dashboard ChaCha ON' }
  }
  return { enabled: false, key: null, source: 'dashboard ChaCha OFF' }
}

async function main() {
  let device = null
  try {
    device = await lookupDevice(API_KEY)
  } catch (err) {
    console.warn(`[dummy-device] could not look up device: ${err.message}`)
  }

  if (!device) {
    console.warn(`[dummy-device] no device for API_KEY=${JSON.stringify(API_KEY)}`)
    if (!FORCE_ENCRYPT && !FORCE_PLAIN && process.env.ENCRYPTION == null) {
      console.warn(
        '[dummy-device] defaulting to plaintext. If ChaCha is ON in the dashboard, run:\n' +
          '  node dummy-device.js --encrypt',
      )
    }
  } else {
    console.log(
      `[dummy-device] device "${device.name}" · ChaCha ${device.encryption_enabled ? 'ON' : 'OFF'}`,
    )
  }

  const enc = resolveMode(device)
  const schemaRel = device?.schemas
  const tip = Array.isArray(schemaRel) ? schemaRel[0] : schemaRel
  const version = Number(process.env.SCHEMA_VERSION) || Number(tip?.version) || SCHEMA_VERSION

  const packed = Buffer.alloc(9)
  packed.writeFloatLE(120.5, 0)
  packed.writeFloatLE(65.2, 4)
  packed.writeUInt8(1, 8)

  const payload = enc.enabled
    ? encryptPayload(prependTimestamp(packed), enc.key)
    : packed

  const buf = Buffer.alloc(16 + 1 + payload.length)
  buf.write(API_KEY, 0, 16, 'utf8')
  buf.writeUInt8(version & 0xff, 16)
  payload.copy(buf, 17)

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: PORT }, () => {
      socket.write(buf)
      const mode = enc.enabled ? 'ChaCha20' : 'plaintext'
      console.log(
        `[dummy-device] fired ${buf.length}B → ${HOST}:${PORT} (${mode}, v${version}, ${enc.source})`,
      )
      console.log(`[dummy-device] hex: ${buf.toString('hex')}`)
      setTimeout(() => socket.end(), 500)
    })
    socket.on('error', (err) => {
      console.error(`[dummy-device] connection error: ${err.message}`)
      reject(err)
    })
    socket.on('close', () => {
      console.log('[dummy-device] connection closed')
      resolve()
    })
  })
}

main().catch((err) => {
  console.error(`[dummy-device] ${err.message}`)
  process.exit(1)
})
