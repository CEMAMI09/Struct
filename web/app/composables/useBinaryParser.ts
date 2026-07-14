import type { SchemaField } from '~/types'
import { TYPE_SIZES } from '~/types'

function normalizeType(type: string) {
  return type.trim().toLowerCase()
}

export function useBinaryParser() {
  function schemaByteLength(schema: SchemaField[]) {
    return schema.reduce((sum, f) => {
      const size = TYPE_SIZES[normalizeType(f.type) as keyof typeof TYPE_SIZES]
      if (!size) throw new Error(`Unsupported type: ${f.type}`)
      return sum + size
    }, 0)
  }

  function parsePayload(buf: Uint8Array, schema: SchemaField[]): Record<string, number | boolean> {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const out: Record<string, number | boolean> = {}
    let offset = 0

    for (const field of schema) {
      const t = normalizeType(field.type)
      const size = TYPE_SIZES[t as keyof typeof TYPE_SIZES]
      if (!size) throw new Error(`Unsupported type "${field.type}"`)
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
        default:
          throw new Error(`Unhandled type "${t}"`)
      }
      offset += size
    }

    return out
  }

  function encodePayload(
    values: Record<string, number | boolean>,
    schema: SchemaField[],
  ): Uint8Array {
    const len = schemaByteLength(schema)
    const buf = new ArrayBuffer(len)
    const view = new DataView(buf)
    let offset = 0

    for (const field of schema) {
      const t = normalizeType(field.type)
      const v = values[field.name]

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
      }
      offset += TYPE_SIZES[t as keyof typeof TYPE_SIZES]
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

  return {
    schemaByteLength,
    parsePayload,
    encodePayload,
    toHex,
    encodeApiKey,
  }
}
