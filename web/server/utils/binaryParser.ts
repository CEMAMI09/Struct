import type { SchemaField } from '../../app/types'
import { fieldByteLength } from '../../app/types'

function decodeCharArray(bytes: Buffer): string {
  let printable = true
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    if (b === 0) break
    if (b < 0x20 || b > 0x7e) {
      printable = false
      break
    }
  }
  if (printable) {
    let end = bytes.length
    while (end > 0 && bytes[end - 1] === 0) end -= 1
    return bytes.subarray(0, end).toString('ascii')
  }
  return bytes.toString('hex')
}

/** Parse a packed little-endian struct buffer with a SchemaField[] definition. */
export function parsePackedPayload(
  buf: Buffer,
  schemaDefinition: SchemaField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let offset = 0

  for (const field of schemaDefinition) {
    const size = fieldByteLength(field)
    if (offset + size > buf.length) {
      throw new Error(
        `Truncated at field "${field.name}" (offset ${offset}, need ${size}, have ${buf.length})`,
      )
    }

    switch (field.type) {
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
        const flags: Record<string, boolean> = {}
        for (const bit of field.bits) {
          flags[bit.name] = ((byte >> Number(bit.bit)) & 1) === 1
        }
        out[field.name] = flags
        break
      }
      case 'char':
        out[field.name] = decodeCharArray(buf.subarray(offset, offset + size))
        break
      default:
        throw new Error(`Unhandled type "${(field as SchemaField).type}"`)
    }
    offset += size
  }

  return out
}
