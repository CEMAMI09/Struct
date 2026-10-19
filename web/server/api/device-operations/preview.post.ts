import {
  managementBody,
  managementContext,
  managementUuid,
  managementError,
  managementCore as core,
} from '../../utils/deviceManagement'
export default defineEventHandler(async (event) => {
  const b = await managementBody(event, 300000),
    org = managementUuid(b.orgId),
    d = b.definition
  const fields = [
    'kind',
    'artifactId',
    'configuration',
    'selection',
    'wavePercentages',
    'manualAdvance',
    'observationSeconds',
    'minimumSamples',
    'failurePercent',
    'maxConcurrent',
    'perMinute',
    'timeoutSeconds',
    'startsAt',
    'endsAt',
  ]
  if (
    !d ||
    typeof d !== 'object' ||
    Array.isArray(d) ||
    !['firmware', 'configuration'].includes(d.kind) ||
    Object.keys(d).some((k) => !fields.includes(k)) ||
    !d.selection ||
    typeof d.selection !== 'object' ||
    Array.isArray(d.selection) ||
    Object.keys(d.selection).some(
      (k) =>
        ![
          'ids',
          'group',
          'tag',
          'all',
          'hardwareModel',
          'firmwareVersion',
        ].includes(k),
    )
  )
    throw createError({
      statusCode: 400,
      message:
        'Use a supported operation, bounded target selection and rollout settings.',
    })
  if (d?.kind === 'configuration') {
    try {
      d.configuration = core.configuration(d.configuration)
    } catch {
      throw createError({
        statusCode: 400,
        message: 'Configuration fields or ranges are invalid.',
      })
    }
  }
  const { service, user } = await managementContext(
    event,
    org,
    d?.kind === 'configuration' ? 'configuration.update' : 'firmware.deploy',
  )
  const r = await service.rpc('management_preview', {
    p_org: org,
    p_actor: user.id,
    p_request: managementUuid(b.requestId),
    p_definition: d,
  })
  managementError(r.error)
  return { id: r.data }
})
