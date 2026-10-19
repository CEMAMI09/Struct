import { uuid } from '../../utils/integrations'
import { fleetBody, fleetContext, fleetError } from '../../utils/fleet'
export default defineEventHandler(async (event) => {
  const b = await fleetBody(event),
    org = uuid(b.orgId),
    { service, user } = await fleetContext(event, org, true)
  if (
    typeof b.name !== 'string' ||
    !b.name.trim() ||
    b.name.length > 100 ||
    (b.id && (!Number.isInteger(b.version) || b.version < 1))
  )
    throw createError({
      statusCode: 400,
      message: 'Group name and current version required.',
    })
  const { data, error } = await service.rpc('fleet_group', {
    p_org: org,
    p_actor: user.id,
    p_id: b.id ? uuid(b.id) : null,
    p_name: b.name,
    p_version: b.version ?? 0,
    p_delete: b.delete === true,
  })
  fleetError(error)
  return { id: data }
})
