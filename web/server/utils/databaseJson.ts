import type { Json } from '../../app/types/database.types'

/** Supabase's generated Json type requires an index signature that domain interfaces omit. */
export function asDatabaseJson(value: Record<string, unknown> | readonly object[]): Json {
  return value as unknown as Json
}
