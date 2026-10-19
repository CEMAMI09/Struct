import { randomBytes, randomUUID } from 'node:crypto'
import {
  managementService,
  managementBody,
  managementError,
  deviceTransport,
  managementCore as core,
} from '../../utils/deviceManagement'
export default defineEventHandler(async (event) => {
  deviceTransport(event)
  const service = await managementService(event),
    b = await managementBody(event, 2048),
    id = randomUUID(),
    nonce = randomBytes(32).toString('hex'),
    wire = Number(b.wireDeviceId)
  if (
    !Number.isInteger(wire) ||
    wire < 1 ||
    wire > 0xffffffff ||
    !/^[a-f0-9]{64}$/.test(b.bodyHash)
  )
    throw createError({ statusCode: 400, message: 'Invalid device challenge.' })
  const r = await service.rpc('management_challenge', {
    p_wire: wire,
    p_id: id,
    p_nonce_hash: core.digest(Buffer.from(nonce, 'hex')),
    p_body_hash: b.bodyHash,
  })
  managementError(r.error)
  return { id, nonce, expiresInSeconds: 60 }
})
