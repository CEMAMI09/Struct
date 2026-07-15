import type { SchemaField, TelemetryValue } from '~/types'
import { TYPE_SIZES } from '~/types'

function normalizeType(type: string) {
  return type.trim().toLowerCase()
}

function validateFlags(field: SchemaField) {
  if (field.type !== 'flags') return
  if (!Array.isArray(field.bits) || !field.bits.length) {
    throw new Error(`flags field "${field.name}" requires bits`)
  }
  const seen = new Set<number>()
  for (const bit of field.bits) {
    const pos = Number(bit.bit)
    if (!Number.isInteger(pos) || pos < 0 || pos > 7) {
      throw new Error(`flags field "${field.name}" bit must be 0..7`)
    }
    if (seen.has(pos)) {
      throw new Error(`flags field "${field.name}" duplicate bit ${pos}`)
    }
    seen.add(pos)
  }
}

function fieldSize(field: SchemaField) {
  if (field.type === 'flags') {
    validateFlags(field)
    return 1
  }
  const size = TYPE_SIZES[normalizeType(field.type) as keyof typeof TYPE_SIZES]
  if (!size) throw new Error(`Unsupported type: ${field.type}`)
  return size
}

export function useBinaryParser() {
  function schemaByteLength(schema: SchemaField[]) {
    return schema.reduce((sum, f) => sum + fieldSize(f), 0)
  }

  function parsePayload(
    buf: Uint8Array,
    schema: SchemaField[],
  ): Record<string, TelemetryValue> {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const out: Record<string, TelemetryValue> = {}
    let offset = 0

    for (const field of schema) {
      const t = normalizeType(field.type)
      const size = fieldSize(field)
      if (offset + size > buf.length) {
        throw new Error(`Truncated at field "${field.name}"`)
      }

      switch (t) {
        case 'float32':
          out[field.name] = view.getFloat32(offset, true)
          break
        case 'int32':
          out[field.name] = view.getInt32(offset, true)
          break
        case 'uint8':
          out[field.name] = view.getUint8(offset)
          break
        case 'boolean':
          out[field.name] = view.getUint8(offset) !== 0
          break
        case 'flags': {
          const byte = view.getUint8(offset)
          const flags: Record<string, boolean> = {}
          for (const bit of field.bits) {
            flags[bit.name] = ((byte >> Number(bit.bit)) & 1) === 1
          }
          out[field.name] = flags
          break
        }
        default:
          throw new Error(`Unhandled type "${t}"`)
      }
      offset += size
    }

    return out
  }

  function encodePayload(
    values: Record<string, TelemetryValue>,
    schema: SchemaField[],
  ): Uint8Array {
    const len = schemaByteLength(schema)
    const buf = new ArrayBuffer(len)
    const view = new DataView(buf)
    let offset = 0

    for (const field of schema) {
      const t = normalizeType(field.type)
      const v = values[field.name]
      const size = fieldSize(field)

      switch (t) {
        case 'float32':
          view.setFloat32(offset, Number(v) || 0, true)
          break
        case 'int32':
          view.setInt32(offset, Number(v) | 0, true)
          break
        case 'uint8':
          view.setUint8(offset, (Number(v) || 0) & 0xff)
          break
        case 'boolean':
          view.setUint8(offset, v ? 1 : 0)
          break
        case 'flags': {
          let byte = 0
          const source =
            v && typeof v === 'object' && !Array.isArray(v)
              ? (v as Record<string, boolean>)
              : {}
          for (const bit of field.bits) {
            if (source[bit.name]) byte |= 1 << Number(bit.bit)
          }
          view.setUint8(offset, byte & 0xff)
          break
        }
      }
      offset += size
    }

    return new Uint8Array(buf)
  }

  function toHex(bytes: Uint8Array, spaced = true): string {
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase())
    return spaced ? hex.join(' ') : hex.join('')
  }

  function encodeApiKey(apiKey: string): Uint8Array {
    const out = new Uint8Array(16)
    const encoded = new TextEncoder().encode(apiKey.slice(0, 16))
    out.set(encoded)
    return out
  }

  async function hmacSha256(secret: string, body: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, body)
    return new Uint8Array(sig)
  }

  async function buildV2TelemetryFrame(opts: {
    keyId: string
    schemaVersion: number
    payload: Uint8Array
    secret: string
    timestampSec?: number
    nonce?: Uint8Array
  }) {
    const timestampSec = opts.timestampSec ?? Math.floor(Date.now() / 1000)
    const nonce = opts.nonce ?? crypto.getRandomValues(new Uint8Array(12))
    const body = new Uint8Array(1 + 16 + 1 + 4 + 12 + opts.payload.length)
    const view = new DataView(body.buffer)
    body[0] = 2
    body.set(encodeApiKey(opts.keyId), 1)
    body[17] = opts.schemaVersion & 0xff
    view.setUint32(18, timestampSec >>> 0, true)
    body.set(nonce, 22)
    body.set(opts.payload, 34)
    const mac = await hmacSha256(opts.secret, body)
    const frame = new Uint8Array(body.length + mac.length)
    frame.set(body, 0)
    frame.set(mac, body.length)
    return { frame, body, mac, nonce, timestampSec }
  }

  return {
    schemaByteLength,
    parsePayload,
    encodePayload,
    toHex,
    encodeApiKey,
    buildV2TelemetryFrame,
  }
}
