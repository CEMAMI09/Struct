import type { H3Event } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from './auth'
import { enterpriseRate, enterpriseError, enterpriseUuid } from './enterprise'
import { decryptApiSecret } from './deviceCredentials'
import { randomBytes, randomUUID } from 'node:crypto'
import * as core from '../../../protocol/management/core.cjs'
export { core as managementCore, enterpriseUuid as managementUuid }
export async function managementService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (process.env.STRUCT_DEVICE_OPERATIONS_ENABLED !== 'true')
    throw createError({
      statusCode: 503,
      message: 'Device operations are not enabled.',
    })
  const service: any = await serverSupabaseServiceRole(event),
    flag = await service
      .from('management_settings')
      .select('enabled')
      .eq('id', true)
      .single()
  if (flag.error || !flag.data?.enabled)
    throw createError({
      statusCode: 503,
      message: 'Device operations database activation is required.',
    })
  return service
}
export function managementError(error: any) {
  if (!error) return
  const code =
    String(error.message).match(/[A-Z][A-Z_]{4,}/)?.[0] ||
    'MANAGEMENT_OPERATION_FAILED'
  throw createError({
    statusCode:
      code.includes('PERMISSION') || code.includes('FOREIGN')
        ? 403
        : code.includes('LIMIT')
          ? 429
          : code.includes('DISABLED')
            ? 503
            : 409,
    message: code.toLowerCase().replaceAll('_', ' '),
    data: { code },
  })
}
export async function managementContext(
  event: H3Event,
  org: string,
  cap = 'device_operations.read',
) {
  const auth = await requireOrgWriter(event, enterpriseUuid(org), cap)
  enterpriseRate(org + ':' + auth.user.id + ':management', 60)
  return { ...auth, service: await managementService(event) }
}
export function managementOrigin(event: H3Event) {
  if (
    getHeader(event, 'sec-fetch-site') === 'cross-site' ||
    (getHeader(event, 'origin') &&
      getHeader(event, 'origin') !== getRequestURL(event).origin)
  )
    throw createError({
      statusCode: 403,
      message: 'Cross-site management requests are denied.',
    })
}
export async function managementBody(event: H3Event, limit = 24576) {
  managementOrigin(event)
  if (!getHeader(event, 'content-type')?.startsWith('application/json'))
    throw createError({ statusCode: 400, message: 'JSON required.' })
  const chunks: Buffer[] = []
  let size = 0
  for await (const data of event.node.req) {
    size += data.length
    if (size > limit)
      throw createError({
        statusCode: 413,
        message: 'Management request too large.',
      })
    chunks.push(Buffer.from(data))
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error()
    return body as Record<string, any>
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid management JSON.' })
  }
}
export function deviceTransport(event: H3Event) {
  const url = getRequestURL(event)
  if (
    url.protocol !== 'https:' &&
    !(
      process.env.STRUCT_MANAGEMENT_ALLOW_LOOPBACK === 'true' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  )
    throw createError({
      statusCode: 426,
      message: 'Authenticated HTTPS is required.',
    })
  enterpriseRate('management-source:' + getRequestIP(event), 60000)
}
export async function deviceMessage(event: H3Event) {
  deviceTransport(event)
  const service = await managementService(event),
    b = await managementBody(event)
  const wire = Number(b.wireDeviceId)
  if (!Number.isInteger(wire) || wire < 1 || wire > 0xffffffff)
    throw createError({
      statusCode: 401,
      message: 'Management identity unavailable.',
    })
  const identity = await service.rpc('management_identity', { p_wire: wire })
  managementError(identity.error)
  let verified: ReturnType<typeof core.authenticate>
  try {
    verified = core.authenticate(
      decryptApiSecret(identity.data.rootEncrypted),
      wire,
      b.challengeId,
      b.nonce,
      b.payload,
      b.mac,
    )
  } catch {
    throw createError({
      statusCode: 401,
      message: 'Management authentication rejected.',
    })
  }
  const { body, hash } = verified
  let data = body.data || {},
    download: any
  if (body.action === 'capabilities') {
    try {
      data = core.capabilities(data)
    } catch {
      throw createError({
        statusCode: 400,
        message: 'Unsupported management capabilities.',
      })
    }
  } else if (body.action === 'poll') {
    const secret = randomBytes(32).toString('hex')
    download = { id: randomUUID(), secret }
    data = {
      downloadId: download.id,
      downloadHash: core.digest(Buffer.from(secret, 'hex')),
    }
  } else if (body.action !== 'report')
    throw createError({
      statusCode: 400,
      message: 'Unsupported device action.',
    })
  const result = await service.rpc('management_device', {
    p_wire: wire,
    p_challenge: enterpriseUuid(b.challengeId),
    p_nonce_hash: core.digest(Buffer.from(b.nonce, 'hex')),
    p_body_hash: hash,
    p_action: body.action,
    p_data: data,
  })
  managementError(result.error)
  if (download && result.data?.operation?.kind === 'firmware')
    Object.assign(result.data.operation, {
      downloadToken: `ota_${download.id}.${download.secret}`,
      downloadPath: `/api/device-management/download/${result.data.operation.id}`,
    })
  return result.data
}
