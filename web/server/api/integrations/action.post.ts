import {
  context,
  uuid,
  bodyBounded,
  databaseError,
  core,
} from '../../utils/integrations'
import { randomUUID } from 'node:crypto'
export default defineEventHandler(async (event) => {
  const body = await bodyBounded(event),
    orgId = uuid(body.orgId),
    id = uuid(body.id),
    { service, user, client } = await context(event, orgId, true)
  const action = body.action
  if (
    ![
      'enable',
      'disable',
      'pause',
      'resume',
      'delete',
      'check',
      'test_send',
      'preview',
      'preview_remap',
      'remap',
    ].includes(action)
  )
    throw createError({
      statusCode: 400,
      message: 'Invalid integration action',
    })
  const { data: row, error } = (await service
    .from('integration_definitions' as never)
    .select('kind,config,route,mapping,version,credentials_encrypted')
    .eq('destination_id', id)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: any; error: any }
  databaseError(error)
  if (!row)
    throw createError({ statusCode: 404, message: 'Integration not found' })
  if (body.version !== row.version)
    throw createError({
      statusCode: 409,
      message: 'Configuration changed. Reload before continuing.',
    })
  if (
    ['delete', 'test_send', 'remap'].includes(action) &&
    body.confirm !== true
  )
    throw createError({
      statusCode: 400,
      message: 'Explicit confirmation required',
    })
  if (action === 'preview_remap' || action === 'remap') {
    const { data, error } = await client.rpc(
      'integration_remap_failed' as never,
      {
        p_org_id: orgId,
        p_destination_id: id,
        p_version: row.version,
        p_request_id: uuid(body.requestId),
        p_confirm: action === 'remap',
      } as never,
    )
    databaseError(error)
    return data
  }
  if (action === 'preview') {
    const sample = body.sample
    if (!sample || typeof sample !== 'object' || Array.isArray(sample))
      throw createError({
        statusCode: 400,
        message: 'Sample payload object required',
      })
    const sampleEvent = {
      payload: sample,
      device_id: body.deviceId || 'sample-device',
      schema_slot: body.schemaSlot ?? 0,
      schema_version: body.schemaVersion ?? null,
      event_type: 'telemetry.received',
    }
    const { data: matched, error: matchError } = await service.rpc(
      'integration_match' as never,
      { rule: row.route, event: sampleEvent, depth: 0 } as never,
    )
    databaseError(matchError)
    try {
      return {
        matched,
        rule: row.route,
        transformed: core.transform(
          {
            id: randomUUID(),
            type: 'telemetry.received',
            device_id: sampleEvent.device_id,
            timestamp: new Date().toISOString(),
            payload: sample,
          },
          row,
        ).value,
      }
    } catch {
      throw createError({
        statusCode: 400,
        message:
          'Sample does not satisfy the saved mapping; check required fields and conversions.',
      })
    }
  }
  // Reserve and audit a rate-limited external operation before starting network work.
  const { error: actionError } = await service.rpc(
    'integration_action' as never,
    {
      p_org_id: orgId,
      p_actor_id: user.id,
      p_id: id,
      p_version: row.version,
      p_action: action,
      p_result: null,
    } as never,
  )
  databaseError(actionError)
  if (action !== 'check' && action !== 'test_send')
    return { action, accepted: true }
  try {
    const secrets = core.open(row.credentials_encrypted, orgId, id),
      eventId = randomUUID()
    const result = await core.execute(
      row,
      secrets,
      {
        id: eventId,
        type: 'integration.test',
        device_id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
          test: true,
          message: 'Explicit Struct integration test; no customer telemetry',
        },
      },
      { id: randomUUID(), total_attempts: 1 },
      { mode: action === 'check' ? 'verify' : 'deliver' },
    )
    const safe = {
      level:
        result.level ||
        (result.outcome === 'delivered'
          ? 'test_event_accepted'
          : 'test_failed'),
      detail: result.detail,
      outcome: result.outcome,
    }
    if (action === 'check') {
      // Optimistic version guard prevents a stale check from validating newer credentials.
      await service
        .from('integration_definitions' as never)
        .update({
          last_check: safe,
          last_checked_at: new Date().toISOString(),
        } as never)
        .eq('destination_id', id)
        .eq('organization_id', orgId)
        .eq('version', row.version)
    }
    return safe
  } catch {
    throw createError({
      statusCode: 400,
      message:
        'Connection test failed. Verify credentials, permissions, public networking and TLS.',
    })
  }
})
