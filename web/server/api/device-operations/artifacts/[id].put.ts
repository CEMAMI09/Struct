import { createWriteStream, createReadStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import {
  managementContext,
  managementUuid,
  managementOrigin,
  managementError,
  managementCore as core,
} from '../../../utils/deviceManagement'
import { firmwareStorage } from '../../../utils/firmwareStorage'
let concurrent = 0
export default defineEventHandler(async (event) => {
  managementOrigin(event)
  const org = managementUuid(getQuery(event).orgId),
    id = managementUuid(getRouterParam(event, 'id')),
    { service, user, requestId } = await managementContext(
      event,
      org,
      'firmware.upload',
    )
  if (getHeader(event, 'content-type') !== 'application/octet-stream')
    throw createError({
      statusCode: 415,
      message: 'Upload the compiled binary as application/octet-stream.',
    })
  if (concurrent >= 4)
    throw createError({
      statusCode: 429,
      message: 'Firmware uploads are busy. Retry later.',
    })
  const a = await service
    .from('firmware_artifacts')
    .select('*')
    .eq('id', id)
    .eq('organization_id', org)
    .eq('state', 'draft')
    .single()
  if (a.error || !a.data)
    throw createError({
      statusCode: 409,
      message: 'Only an immutable draft can receive binary content.',
    })
  if (concurrent >= 4)
    throw createError({
      statusCode: 429,
      message: 'Firmware uploads are busy. Retry later.',
    })
  concurrent++
  let directory: string | undefined
  try {
    directory = await mkdtemp(join(tmpdir(), 'struct-firmware-'))
    const file = join(directory, 'image.bin'),
      hash = createHash('sha256')
    let size = 0,
      header = Buffer.alloc(0),
      tail = Buffer.alloc(0),
      factoryImage = false
    const bounded = new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length
        if (size > a.data.size || size > core.MAX_IMAGE)
          return done(new Error('Firmware exceeds declared size'))
        const check = Buffer.concat([tail, chunk])
        if (check.includes(core.FACTORY_MARKER)) factoryImage = true
        tail = check.subarray(
          Math.max(0, check.length - core.FACTORY_MARKER.length + 1),
        )
        hash.update(chunk)
        if (header.length < 80)
          header = Buffer.concat([header, chunk]).subarray(0, 80)
        done(null, chunk)
      },
    })
    await pipeline(
      event.node.req,
      bounded,
      createWriteStream(file, { flags: 'wx', mode: 0o600 }),
      { signal: AbortSignal.timeout(120000) },
    )
    if (factoryImage)
      throw createError({
        statusCode: 400,
        message:
          'Factory provisioning images contain device-specific credentials and cannot be used for OTA. Build struct-ota.',
        data: { code: 'FACTORY_IMAGE_FORBIDDEN' },
      })
    const sha256 = hash.digest('hex')
    if (size !== a.data.size || sha256 !== a.data.sha256)
      throw Error('Firmware hash or length mismatch')
    core.validateImageHeader(header, a.data.manifest)
    await firmwareStorage(service).put(a.data.object_path, file, {
      size,
      sha256,
    })
    const r = await service.rpc('management_admin', {
      p_org: org,
      p_actor: user.id,
      p_action: 'uploaded',
      p_data: { id, sha256, size },
      p_request: requestId,
    })
    managementError(r.error)
    return { id, verified: true }
  } catch (e: any) {
    if (e.statusCode) throw e
    throw createError({
      statusCode: 400,
      message:
        'Firmware upload rejected or storage unavailable. Verify the signed hash, image and length.',
    })
  } finally {
    concurrent--
    if (directory && resolve(directory).startsWith(resolve(tmpdir()) + sep))
      await rm(directory, { recursive: true, force: true })
  }
})
