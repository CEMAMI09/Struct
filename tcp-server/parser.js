/**
 * Schema-driven little-endian binary payload parser.
 * Mirrors packed ESP32 / Arduino structs (`#pragma pack(push, 1)`).
 */

const TYPE_SIZES = {
  float32: 4,
  int32: 4,
  uint8: 1,
  boolean: 1,
}

function normalizeType(type) {
  return String(type || '')
    .trim()
    .toLowerCase()
}

function schemaByteLength(schemaDefinition) {
  let total = 0
  for (const field of schemaDefinition) {
    const t = normalizeType(field.type)
    const size = TYPE_SIZES[t]
    if (!size) {
      throw new Error(`Unsupported schema type: ${field.type}`)
    }
    total += size
  }
  return total
}

/**
 * @param {Buffer} buf - payload only (no API key)
 * @param {Array<{name: string, type: string}>} schemaDefinition
 * @returns {Record<string, number | boolean>}
 */
function parsePayload(buf, schemaDefinition) {
  const out = {}
  let offset = 0

  for (const field of schemaDefinition) {
    const t = normalizeType(field.type)
    const size = TYPE_SIZES[t]

    if (!size) {
      throw new Error(`Unsupported schema type "${field.type}" for field "${field.name}"`)
    }
    if (offset + size > buf.length) {
      throw new Error(
        `Unaligned / truncated payload at field "${field.name}" (offset ${offset}, need ${size}, have ${buf.length})`,
      )
    }

    switch (t) {
      case 'float32':
        out[field.name] = buf.readFloatLE(offset)
        break
      case 'int32':
        out[field.name] = buf.readInt32LE(offset)
        break
      case 'uint8':
        out[field.name] = buf.readUInt8(offset)
        break
      case 'boolean':
        out[field.name] = buf.readUInt8(offset) !== 0
        break
      default:
        throw new Error(`Unhandled type "${t}"`)
    }

    offset += size
  }

  return out
}

/**
 * Encode a JS object back into a packed Buffer (used by Live Debugger sim).
 */
function encodePayload(values, schemaDefinition) {
  const len = schemaByteLength(schemaDefinition)
  const buf = Buffer.alloc(len)
  let offset = 0

  for (const field of schemaDefinition) {
    const t = normalizeType(field.type)
    const v = values[field.name]

    switch (t) {
      case 'float32':
        buf.writeFloatLE(Number(v) || 0, offset)
        break
      case 'int32':
        buf.writeInt32LE(Number(v) | 0, offset)
        break
      case 'uint8':
        buf.writeUInt8((Number(v) || 0) & 0xff, offset)
        break
      case 'boolean':
        buf.writeUInt8(v ? 1 : 0, offset)
        break
      default:
        throw new Error(`Unhandled type "${t}"`)
    }

    offset += TYPE_SIZES[t]
  }

  return buf
}

module.exports = {
  TYPE_SIZES,
  schemaByteLength,
  parsePayload,
  encodePayload,
  normalizeType,
}
