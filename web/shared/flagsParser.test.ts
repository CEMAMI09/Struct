import { describe, expect, it } from 'vitest'
import type { SchemaField } from '../app/types'
import { TYPE_SIZES } from '../app/types'

/**
 * Mirror of useBinaryParser / useCppHeader logic for unit tests without Nuxt.
 */

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

function schemaByteLength(schema: SchemaField[]) {
  return schema.reduce((sum, f) => {
    if (f.type === 'flags') {
      validateFlags(f)
      return sum + 1
    }
    return sum + (TYPE_SIZES[f.type] || 0)
  }, 0)
}

function encodePayload(values: Record<string, unknown>, schema: SchemaField[]) {
  const len = schemaByteLength(schema)
  const buf = new ArrayBuffer(len)
  const view = new DataView(buf)
  let offset = 0
  for (const field of schema) {
    const v = values[field.name]
    if (field.type === 'float32') {
      view.setFloat32(offset, Number(v) || 0, true)
      offset += 4
    } else if (field.type === 'int32') {
      view.setInt32(offset, Number(v) | 0, true)
      offset += 4
    } else if (field.type === 'uint8') {
      view.setUint8(offset, (Number(v) || 0) & 0xff)
      offset += 1
    } else if (field.type === 'boolean') {
      view.setUint8(offset, v ? 1 : 0)
      offset += 1
    } else if (field.type === 'flags') {
      let byte = 0
      const source = v && typeof v === 'object' ? (v as Record<string, boolean>) : {}
      for (const bit of field.bits) {
        if (source[bit.name]) byte |= 1 << Number(bit.bit)
      }
      view.setUint8(offset, byte & 0xff)
      offset += 1
    }
  }
  return new Uint8Array(buf)
}

function parsePayload(buf: Uint8Array, schema: SchemaField[]) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: Record<string, unknown> = {}
  let offset = 0
  for (const field of schema) {
    const size = field.type === 'flags' ? 1 : TYPE_SIZES[field.type]
    if (offset + size > buf.length) throw new Error(`Truncated at field "${field.name}"`)
    if (field.type === 'float32') out[field.name] = view.getFloat32(offset, true)
    else if (field.type === 'int32') out[field.name] = view.getInt32(offset, true)
    else if (field.type === 'uint8') out[field.name] = view.getUint8(offset)
    else if (field.type === 'boolean') out[field.name] = view.getUint8(offset) !== 0
    else if (field.type === 'flags') {
      const byte = view.getUint8(offset)
      const flags: Record<string, boolean> = {}
      for (const bit of field.bits) {
        flags[bit.name] = ((byte >> Number(bit.bit)) & 1) === 1
      }
      out[field.name] = flags
    }
    offset += size
  }
  return out
}

function generateCppMasks(fields: SchemaField[]) {
  const lines: string[] = []
  for (const f of fields) {
    if (f.type !== 'flags') continue
    const group = f.name.toUpperCase()
    for (const bit of f.bits) {
      lines.push(`#define ${group}_${bit.name.toUpperCase()} (1u << ${bit.bit})`)
    }
  }
  return lines
}

describe('flags schema packing', () => {
  const schema: SchemaField[] = [
    { name: 'temp', type: 'float32' },
    {
      name: 'status',
      type: 'flags',
      bits: [
        { name: 'motor_active', bit: 0 },
        { name: 'door_open', bit: 1 },
      ],
    },
    { name: 'rssi', type: 'uint8' },
  ]

  it('counts each flags group as 1 byte', () => {
    expect(schemaByteLength(schema)).toBe(6)
  })

  it('packs 8 booleans into 1 byte with mixed offsets', () => {
    const values = {
      temp: 21.5,
      status: { motor_active: true, door_open: true },
      rssi: 200,
    }
    const buf = encodePayload(values, schema)
    expect(buf.length).toBe(6)
    expect(buf[4]).toBe(0b00000011)
    expect(buf[5]).toBe(200)
    const parsed = parsePayload(buf, schema)
    expect(parsed.status).toEqual({ motor_active: true, door_open: true })
    expect(parsed.rssi).toBe(200)
  })

  it('throws on truncated payload', () => {
    expect(() => parsePayload(new Uint8Array(5), schema)).toThrow(/Truncated/)
  })

  it('emits C++ backing byte masks', () => {
    const masks = generateCppMasks(schema)
    expect(masks).toContain('#define STATUS_MOTOR_ACTIVE (1u << 0)')
    expect(masks).toContain('#define STATUS_DOOR_OPEN (1u << 1)')
  })
})
