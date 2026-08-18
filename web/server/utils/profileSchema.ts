import type { SchemaField } from '../../app/types'

export function validateProfileSchema(
  schemaDefinition: unknown,
  identityField: string,
): SchemaField[] {
  if (!Array.isArray(schemaDefinition) || !schemaDefinition.length) {
    throw createError({ statusCode: 400, message: 'schemaDefinition must be a non-empty array' })
  }

  const fields: SchemaField[] = []
  const names = new Set<string>()

  for (const raw of schemaDefinition) {
    if (!raw || typeof raw !== 'object') {
      throw createError({ statusCode: 400, message: 'Invalid schema field' })
    }
    const name = String((raw as any).name || '').trim()
    const type = String((raw as any).type || '').trim().toLowerCase()
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw createError({
        statusCode: 400,
        message: `Invalid field name "${name || '(empty)'}"`,
      })
    }
    if (names.has(name)) {
      throw createError({ statusCode: 400, message: `Duplicate field name "${name}"` })
    }
    names.add(name)

    if (type === 'flags') {
      const bitsRaw = Array.isArray((raw as any).bits) ? (raw as any).bits : []
      const bits = bitsRaw
        .map((b: any) => ({
          name: String(b?.name || '').trim(),
          bit: Number(b?.bit) | 0,
        }))
        .filter((b: { name: string }) => b.name)
      if (!bits.length) {
        throw createError({
          statusCode: 400,
          message: `Flags field "${name}" requires at least one bit`,
        })
      }
      fields.push({ name, type: 'flags', bits })
      continue
    }

    if (type === 'char') {
      const length = Number((raw as any).length)
      if (!Number.isInteger(length) || length < 1 || length > 64) {
        throw createError({
          statusCode: 400,
          message: `char field "${name}" length must be 1..64`,
        })
      }
      fields.push({ name, type: 'char', length })
      continue
    }

    if (!['float32', 'int32', 'uint8', 'boolean'].includes(type)) {
      throw createError({ statusCode: 400, message: `Unsupported field type "${type}"` })
    }
    fields.push({ name, type: type as 'float32' | 'int32' | 'uint8' | 'boolean' })
  }

  const identity = identityField.trim()
  if (!identity || !names.has(identity)) {
    throw createError({
      statusCode: 400,
      message: `identityField "${identity || '(empty)'}" must match a schema field`,
    })
  }

  return fields
}
