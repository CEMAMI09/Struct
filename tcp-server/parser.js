/**
 * Schema-driven little-endian binary payload parser.
 * Mirrors packed ESP32 / Arduino structs (`#pragma pack(push, 1)`).
 *
 * Supported types: float32, int32, uint8, boolean, flags
 * flags: one uint8 packed with nested { name, bit } entries (bits 0–7).
 */

const TYPE_SIZES = {
  float32: 4,
  int32: 4,
  uint8: 1,
  boolean: 1,
  flags: 1,
}

function normalizeType(type) {
  return String(type || '')
    .trim()
    .toLowerCase()
}

function fieldByteLength(field) {
  const t = normalizeType(field.type)
  if (t === 'flags') {
    validateFlagsField(field)
    return 1
  }
  const size = TYPE_SIZES[t]
  if (!size) {
    throw new Error(`Unsupported schema type: ${field.type}`)
  }
  return size
}

function validateFlagsField(field) {
  if (!Array.isArray(field.bits) || !field.bits.length) {
    throw new Error(`flags field "${field.name}" requires a non-empty bits array`)
  }
  const seen = new Set()
  for (const bit of field.bits) {
    if (!bit || typeof bit.name !== 'string' || !bit.name) {
      throw new Error(`flags field "${field.name}" has an invalid bit name`)
    }
    const pos = Number(bit.bit)
    if (!Number.isInteger(pos) || pos < 0 || pos > 7) {
      throw new Error(`flags field "${field.name}" bit "${bit.name}" must be 0..7`)
    }
    if (seen.has(pos)) {
      throw new Error(`flags field "${field.name}" has duplicate bit position ${pos}`)
    }
    seen.add(pos)
  }
}

function schemaByteLength(schemaDefinition) {
  let total = 0
  for (const field of schemaDefinition) {
    total += fieldByteLength(field)
  }
  return total
}

/**
 * @param {Buffer} buf - payload only
 * @param {Array<object>} schemaDefinition
 * @returns {Record<string, number | boolean | Record<string, boolean>>}
 */
function parsePayload(buf, schemaDefinition) {
  const out = {}
  let offset = 0

  for (const field of schemaDefinition) {
    const t = normalizeType(field.type)
    const size = fieldByteLength(field)

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
      case 'flags': {
        const byte = buf.readUInt8(offset)
        const flags = {}
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

/**
 * Encode a JS object back into a packed Buffer.
 */
function encodePayload(values, schemaDefinition) {
  const len = schemaByteLength(schemaDefinition)
  const buf = Buffer.alloc(len)
  let offset = 0

  for (const field of schemaDefinition) {
    const t = normalizeType(field.type)
    const v = values[field.name]
    const size = fieldByteLength(field)

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
      case 'flags': {
        let byte = 0
        const source = v && typeof v === 'object' ? v : {}
        for (const bit of field.bits) {
          if (source[bit.name]) {
            byte |= 1 << Number(bit.bit)
          }
        }
        buf.writeUInt8(byte & 0xff, offset)
        break
      }
      default:
        throw new Error(`Unhandled type "${t}"`)
    }

    offset += size
  }

  return buf
}

module.exports = {
  TYPE_SIZES,
  schemaByteLength,
  parsePayload,
  encodePayload,
  normalizeType,
  fieldByteLength,
  validateFlagsField,
}
