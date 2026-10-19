import { createHash } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  managementService,
  managementUuid,
  managementError,
  deviceTransport,
} from '../../../utils/deviceManagement'
import { firmwareStorage } from '../../../utils/firmwareStorage'
let streams = 0
export default defineEventHandler(async (event) => {
  deviceTransport(event)
  const service = await managementService(event),
    operation = managementUuid(getRouterParam(event, 'id')),
    auth = getHeader(event, 'authorization') || ''
  const match = /^Bearer ota_([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(auth)
  if (!match)
    throw createError({
      statusCode: 401,
      message: 'Device-scoped download authorization required.',
    })
  if (streams >= 8)
    throw createError({
      statusCode: 429,
      message: 'Firmware download concurrency limit. Retry later.',
    })
  const r = await service.rpc('management_download', {
    p_id: managementUuid(match[1]),
    p_hash: createHash('sha256')
      .update(Buffer.from(match[2]!, 'hex'))
      .digest('hex'),
    p_operation: operation,
  })
  managementError(r.error)
  const info = r.data,
    range = getHeader(event, 'range'),
    parsed = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null
  if (range && !parsed)
    throw createError({
      statusCode: 416,
      message: 'One bounded byte range is supported.',
    })
  const start = parsed ? Number(parsed[1]) : 0,
    end = parsed?.[2] ? Number(parsed[2]) : info.size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= info.size
  )
    throw createError({
      statusCode: 416,
      message: 'Firmware range exceeds the artifact.',
    })
  // Reserve synchronously after authorization: concurrent RPC completions cannot
  // all pass an earlier check and oversubscribe the stream budget.
  if (streams >= 8)
    throw createError({
      statusCode: 429,
      message: 'Firmware download concurrency limit. Retry later.',
    })
  streams++
  let sent = 0,
    complete = false
  try {
    const stream = await firmwareStorage(service).read(
        info.objectPath,
        start,
        end,
      ),
      bound = new Transform({
        transform(chunk, _encoding, done) {
          sent += chunk.length
          if (sent > end - start + 1)
            return done(Error('Storage length mismatch'))
          done(null, chunk)
        },
      })
    setHeader(event, 'Content-Type', 'application/octet-stream')
    setHeader(event, 'Content-Length', end - start + 1)
    setHeader(event, 'Accept-Ranges', 'bytes')
    setHeader(event, 'ETag', `"${info.sha256}"`)
    if (parsed) {
      setResponseStatus(event, 206)
      setHeader(event, 'Content-Range', `bytes ${start}-${end}/${info.size}`)
    }
    await pipeline(stream, bound, event.node.res, {
      signal: AbortSignal.timeout(120000),
    })
    complete = sent === end - start + 1
  } finally {
    streams--
    // Optional accounting is bounded and awaited after the response stream;
    // it cannot turn delivered bytes into an installation or billing guarantee.
    try {
      await service
        .rpc('management_transfer', {
          p_operation: operation,
          p_bytes: sent,
          p_complete: complete,
        })
        .abortSignal(AbortSignal.timeout(3000))
    } catch {}
  }
})
