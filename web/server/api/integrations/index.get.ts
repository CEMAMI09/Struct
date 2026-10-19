import {
  context,
  uuid,
  SAFE_INTEGRATION_FIELDS,
  databaseError,
} from '../../utils/integrations'
export default defineEventHandler(async (event) => {
  const orgId = uuid(getQuery(event).orgId),
    { service, client } = await context(event, orgId)
  const { data, error } = await service
    .from('integration_definitions' as never)
    .select(SAFE_INTEGRATION_FIELDS)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(20)
  databaseError(error)
  const health = await client.rpc('delivery_overview', { p_org_id: orgId })
  return { integrations: data || [], health: health.data }
})
