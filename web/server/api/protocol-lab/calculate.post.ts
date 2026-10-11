import { createHash } from 'node:crypto'
import { calculate } from '../../protocol-lab/engine'
import { loadResearch } from '../../protocol-lab/data'
import { validateConfig } from '../../protocol-lab/encoding'
import type { LabResponse } from '#shared/protocol-lab/types'
const cache = new Map<string, LabResponse>()
const limits = new Map<string, { until: number; count: number }>()
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  if (!getHeader(event, 'content-type')?.includes('application/json'))
    throw createError({ statusCode: 415, message: 'Use application/json.' })
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown',
    now = Date.now(),
    bucket = limits.get(ip)
  if (bucket && bucket.until > now) {
    if (++bucket.count > 120)
      throw createError({ statusCode: 429, message: 'Please wait before recalculating.' })
  } else {
    if (limits.size >= 1000) limits.delete(limits.keys().next().value!)
    limits.set(ip, { until: now + 60000, count: 1 })
  }
  const stream = getRequestWebStream(event)
  if (!stream) throw createError({ statusCode: 400, message: 'A JSON configuration is required.' })
  const reader = stream.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 65536) {
        await reader.cancel()
        throw createError({ statusCode: 413, message: 'Configuration exceeds 64 KB.' })
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  let config: unknown
  try {
    config = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    validateConfig(config)
  } catch (error) {
    throw createError({
      statusCode: 422,
      message: error instanceof Error ? error.message : 'Invalid configuration.',
    })
  }
  const key = createHash('sha256').update(JSON.stringify(config)).digest('hex')
  if (cache.has(key)) return cache.get(key)
  const data = await loadResearch().catch(() => {
    throw createError({ statusCode: 503, message: 'Benchmark dataset is unavailable. Please retry later.' })
  })
  try {
    const response = calculate(config, data)
    if (cache.size >= 64) cache.delete(cache.keys().next().value!)
    cache.set(key, response)
    return response
  } catch (error) {
    throw createError({
      statusCode: 422,
      message: error instanceof Error ? error.message : 'Calculation failed.',
    })
  }
})
