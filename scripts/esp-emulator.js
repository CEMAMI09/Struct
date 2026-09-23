/**
 * Fake ESP32 fleet. Packs each device's published schema and sends
 * Protocol v2 UDP frames to the local telemetry gateway.
 *
 *   node scripts/esp-emulator.js
 *   node scripts/esp-emulator.js --count 40 --interval 1500
 *   KEY_ID=… API_SECRET=… node scripts/esp-emulator.js --once
 *
 * Credentials are decrypted locally from the gateway env and never printed.
 */
const crypto = require('crypto')
const dgram = require('dgram')
const path = require('path')

const tcpRoot = path.join(__dirname, '..', 'tcp-server')
require(path.join(tcpRoot, 'node_modules', 'dotenv')).config({
  path: path.join(tcpRoot, '.env'),
})

const { createClient } = require(path.join(tcpRoot, 'node_modules', '@supabase/supabase-js'))
const { decryptSecret } = require(path.join(tcpRoot, 'auth'))
const { buildTelemetryFrame } = require(path.join(tcpRoot, 'protocol'))
const { encodePayload } = require(path.join(tcpRoot, 'parser'))

const HOST = process.env.HOST || '127.0.0.1'
const UDP_PORT = Number(process.env.UDP_PORT || 8081)

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) return fallback
  return value
}

const ONCE = process.argv.includes('--once')
const COUNT = ONCE ? 1 : Number(argValue('--count', '0'))
const INTERVAL_MS = Number(argValue('--interval', '2000'))
const KEY_FILTER = process.env.KEY_ID || argValue('--key', '')

function gaussian() {
  const u = Math.random() || 1e-9
  const v = Math.random() || 1e-9
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

const tracks = new Map()

function track(key, start) {
  let state = tracks.get(key)
  if (!state) {
    state = { value: start, bias: 0 }
    tracks.set(key, state)
  }
  return state
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Room temperature: thermal lag, slow drift, and the odd step from a vent or door. */
function nextTemp(key) {
  const state = track(key, 22.4 + Math.random() * 1.6)
  state.bias = state.bias * 0.985 + gaussian() * 0.035
  if (Math.random() < 0.035) {
    state.bias += (Math.random() < 0.55 ? -1 : 1) * (0.25 + Math.random() * 1.1)
  }
  state.bias = clamp(state.bias, -2.8, 3.4)
  state.value = state.value * 0.86 + (23.1 + state.bias) * 0.14 + gaussian() * 0.04
  return roundTo(clamp(state.value, 18.4, 31.5), 1)
}

/** Trial reaction time in ms: clustered around a mean, slow fatigue, uneven lapses. */
function nextReaction(key) {
  const state = track(key, 240 + Math.round(Math.random() * 30))
  state.bias = state.bias * 0.96 + 0.45 + gaussian() * 1.1
  if (Math.random() < 0.06) state.bias = -6 - Math.random() * 28
  state.bias = clamp(state.bias, -30, 80)

  const roll = Math.random()
  let sample = 228 + state.bias + Math.abs(gaussian()) * 12
  if (roll < 0.07) sample += 55 + Math.random() * 180
  else if (roll < 0.2) sample += 12 + Math.random() * 40
  else if (roll > 0.94) sample -= 8 + Math.random() * 22

  state.value = state.value * 0.2 + sample * 0.8
  return Math.round(clamp(state.value, 164, 680))
}

function nextWalk(key, spec) {
  const state = track(key, spec.center)
  state.bias = state.bias * 0.94 + gaussian() * spec.step
  if (Math.random() < (spec.jump || 0.04)) state.bias += gaussian() * spec.step * 5
  state.bias = clamp(state.bias, -spec.span, spec.span)
  state.value =
    state.value * spec.inertia +
    (spec.center + state.bias) * (1 - spec.inertia) +
    gaussian() * spec.noise
  return roundTo(clamp(state.value, spec.min, spec.max), spec.decimals)
}

function stickyBit(key) {
  const state = track(key, Math.random() < 0.65)
  if (Math.random() < 0.08) state.value = !state.value
  return state.value ? 1 : 0
}

function sampleField(deviceName, field) {
  const name = String(field.name || '').toLowerCase()
  const type = String(field.type || '').toLowerCase()
  const key = `${deviceName}:${field.name}`

  if (type === 'flags') {
    const flags = {}
    for (const bit of field.bits || []) flags[bit.name] = !!stickyBit(`${key}:${bit.name}`)
    return flags
  }
  if (type === 'char') return 'esp32'
  if (type === 'boolean') return !!stickyBit(key)

  let value
  if (name.includes('reaction')) value = nextReaction(key)
  else if (name.includes('temp')) value = nextTemp(key)
  else if (name.includes('humid')) {
    value = nextWalk(key, { center: 47, inertia: 0.9, step: 0.35, noise: 0.25, span: 14, min: 28, max: 78, decimals: 1, jump: 0.03 })
  } else if (name.includes('volt') || name.includes('battery')) {
    value = nextWalk(key, { center: 3.78, inertia: 0.96, step: 0.004, noise: 0.003, span: 0.12, min: 3.35, max: 4.15, decimals: 2, jump: 0.01 })
  } else if (name.includes('rssi')) {
    value = nextWalk(key, { center: -67, inertia: 0.7, step: 1.2, noise: 0.8, span: 12, min: -96, max: -42, decimals: 0, jump: 0.06 })
  } else if (name.includes('active') || name.includes('status')) {
    value = stickyBit(key)
  } else {
    value = nextWalk(key, { center: 40, inertia: 0.75, step: 1.1, noise: 0.6, span: 18, min: 0, max: 100, decimals: 1, jump: 0.05 })
  }

  if (type === 'uint8') return Math.max(0, Math.min(255, Math.round(value)))
  if (type === 'int32') return Math.round(value)
  return value
}

function samplePayload(deviceName, schema) {
  const values = {}
  for (const field of schema) values[field.name] = sampleField(deviceName, field)
  return values
}

function formatValues(values) {
  return Object.entries(values)
    .map(([key, value]) => {
      if (typeof value === 'number') return `${key}=${value}`
      if (typeof value === 'boolean') return `${key}=${value ? 1 : 0}`
      return `${key}=${JSON.stringify(value)}`
    })
    .join(' ')
}

const DEFAULT_SCHEMA = [
  { name: 'reaction_time', type: 'float32' },
  { name: 'temp', type: 'float32' },
]

function explicitDevice() {
  const keyId = process.env.KEY_ID || ''
  const secret = process.env.API_SECRET || ''
  if (!keyId && !secret) return null
  if (!/^[!-~]{16}$/.test(keyId) || !secret) {
    throw new Error('Set both KEY_ID (16 ASCII characters) and API_SECRET')
  }
  let schema = DEFAULT_SCHEMA
  if (process.env.SCHEMA_JSON) {
    const parsed = JSON.parse(process.env.SCHEMA_JSON)
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('SCHEMA_JSON must be a non-empty field array')
    schema = parsed
  }
  return [
    {
      name: process.env.DEVICE_NAME || 'ESP32',
      keyId,
      secret,
      version: Number(process.env.SCHEMA_VERSION || 1),
      schema,
    },
  ]
}

async function loadDevices() {
  const explicit = explicitDevice()
  if (explicit) return explicit

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Gateway .env is missing Supabase credentials')

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase
    .from('devices')
    .select('id, name, key_id, api_secret_encrypted, schemas(version, schema_definition)')
    .order('name')
  if (error) throw new Error(error.message)

  return (data || [])
    .map((device) => {
      const schemaRel = Array.isArray(device.schemas) ? device.schemas[0] : device.schemas
      const definition = schemaRel?.schema_definition
      return {
        name: device.name,
        keyId: device.key_id,
        secret: decryptSecret(device.api_secret_encrypted),
        version: Number(schemaRel?.version) || 1,
        schema: Array.isArray(definition) ? definition : [],
      }
    })
    .filter((device) => device.schema.length > 0)
    .filter((device) => !KEY_FILTER || device.keyId === KEY_FILTER)
}

function sendFrame(socket, frame) {
  return new Promise((resolve, reject) => {
    socket.send(frame, UDP_PORT, HOST, (err) => (err ? reject(err) : resolve()))
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const devices = await loadDevices()
  if (!devices.length) {
    throw new Error('No devices with a published schema. Add fields on the schema page first.')
  }

  const socket = dgram.createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  let tick = 0
  const stopAt = COUNT > 0 ? COUNT : Infinity

  console.log(
    `[esp] ${devices.length} device(s) → ${HOST}:${UDP_PORT} UDP about every ${INTERVAL_MS}ms` +
      (stopAt === Infinity ? '' : `, ${stopAt} pings`),
  )

  try {
    while (tick < stopAt) {
      const timestampSec = Math.floor(Date.now() / 1000)
      for (let index = 0; index < devices.length; index++) {
        const device = devices[index]
        const values = samplePayload(device.name, device.schema)
        const payload = encodePayload(values, device.schema)
        const frame = buildTelemetryFrame({
          keyId: device.keyId,
          schemaVersion: device.version,
          timestampSec,
          nonce: crypto.randomBytes(12),
          payload,
          secret: device.secret,
        })
        await sendFrame(socket, frame)
        console.log(`[esp] ${device.name} ${formatValues(values)} (${frame.length}B)`)
      }
      tick += 1
      if (tick < stopAt) {
        const jitter = INTERVAL_MS * (0.55 + Math.random() * 0.9)
        await sleep(Math.round(jitter))
      }
    }
  } finally {
    socket.close()
  }
}

main().catch((err) => {
  console.error(`[esp] ${err.message}`)
  process.exit(1)
})
