import { uuid } from '../../utils/integrations'
import {
  observabilityContext,
  observabilityBody,
  monitoringError,
} from '../../utils/observability'
import { RULE_KINDS } from '#shared/observability'
export default defineEventHandler(async (event) => {
  const b = await observabilityBody(event),
    org = uuid(b.orgId),
    { service, user } = await observabilityContext(
      event,
      org,
      b.action==='acknowledge'?'alerts.acknowledge':b.action !== 'email_preferences',
    )
  const actions = [
    'preferences',
    'policy',
    'rule',
    'acknowledge',
    'resolve',
    'mute',
    'toggle',
    'delete_rule',
    'email_preferences',
  ]
  if (
    !actions.includes(b.action) ||
    !b.data ||
    typeof b.data !== 'object' ||
    Array.isArray(b.data)
  )
    throw createError({
      statusCode: 400,
      message: 'Invalid monitoring action.',
    })
  const d = b.data
  if (b.action === 'rule' && d.kind === 'sensor' && (!d.device || !d.field))
    throw createError({
      statusCode: 400,
      message:
        'Sensor rules require one device and a numeric field. Group-wide sensor evaluation is unavailable.',
    })
  if (
    b.action === 'rule' &&
    (!RULE_KINDS.includes(d.kind) ||
      !Number.isFinite(Number(d.threshold)) ||
      !Number.isFinite(Number(d.clear)))
  )
    throw createError({
      statusCode: 400,
      message: 'Choose a supported rule and finite thresholds.',
    })
  for (const k of ['id', 'device', 'group', 'webhook']) if (d[k]) uuid(d[k])
  const r = await service.rpc('observability_command', {
    p_org: org,
    p_actor: user.id,
    p_action: b.action,
    p_data: d,
  })
  monitoringError(r.error)
  return r.data
})
