// Test-only Nuxt server boundary. The production Nuxt alias is unchanged.
import { vi } from 'vitest'
export const serverSupabaseClient = vi.fn()
export const serverSupabaseServiceRole = vi.fn()
