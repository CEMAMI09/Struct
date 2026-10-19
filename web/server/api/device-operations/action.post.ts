import {
  managementBody,
  managementContext,
  managementUuid,
  managementError,
  managementCore as core,
} from '../../utils/deviceManagement'
export default defineEventHandler(async (event) => {
  const b = await managementBody(event),
    org = managementUuid(b.orgId),
    action = String(b.action)
  const caps: Record<string, string> = {
    key: 'firmware.manage_signing_keys',
    revoke_key: 'firmware.manage_signing_keys',
    artifact: 'firmware.upload',
    approve: 'firmware.approve',
    enable_device: 'device_operations.manage',
    confirm:
      b.data?.kind === 'configuration'
        ? 'configuration.deploy'
        : 'firmware.deploy',
    pause: 'firmware.cancel',
    resume: 'firmware.deploy',
    cancel: 'firmware.cancel',
    advance: 'firmware.deploy',
  }
  if (!caps[action])
    throw createError({ statusCode: 400, message: 'Unsupported operation.' })
  const { service, user, requestId } = await managementContext(
    event,
    org,
    caps[action],
  )
  let data = b.data || {}
  if (action === 'key') {
    try {
      data = {
        id: managementUuid(data.id),
        name: String(data.name).slice(0, 80),
        publicPem: data.publicPem,
        fingerprint: core.fingerprint(data.publicPem),
      }
    } catch {
      throw createError({
        statusCode: 400,
        message: 'A public P-256 verification key is required.',
      })
    }
  } else if (action === 'artifact') {
    const key = await service
      .from('firmware_signing_keys')
      .select('public_pem')
      .eq('id', managementUuid(data.manifest?.keyId))
      .eq('organization_id', org)
      .is('revoked_at', null)
      .single()
    if (key.error)
      throw createError({
        statusCode: 403,
        message: 'Signing key unavailable.',
      })
    try {
      data = {
        manifest: data.manifest,
        signature: data.signature,
        canonical: core
          .verifyManifest(data.manifest, data.signature, key.data.public_pem)
          .toString('ascii'),
        releaseNotes: data.releaseNotes || '',
        channel: data.channel || 'testing',
      }
    } catch {
      throw createError({
        statusCode: 400,
        message: 'Signed firmware manifest rejected.',
      })
    }
  } else
    data = {
      id: managementUuid(data.id),
      enabled: data.enabled === true,
      confirm: data.confirm === true,
      kind: data.kind,
    }
  const r = await service.rpc('management_admin', {
    p_org: org,
    p_actor: user.id,
    p_action: action,
    p_data: data,
    p_request: requestId,
  })
  managementError(r.error)
  return r.data
})
