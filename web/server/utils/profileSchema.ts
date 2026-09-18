import type { SchemaField } from '../../app/types'
import { validateSchema } from '#shared/schemaCodegen'

export function validateProfileSchema(schemaDefinition: unknown, identityField: string): SchemaField[] {
  try {
    validateSchema(schemaDefinition)
    const field = schemaDefinition.find(f => f.name === identityField.trim())
    if (!field || !['char', 'int32', 'uint8'].includes(field.type)) {
      throw new Error('identityField must name a char, int32 or uint8 field')
    }
    return schemaDefinition
  } catch (e: any) {
    throw createError({ statusCode: 400, message: e.message || 'Invalid schema' })
  }
}
