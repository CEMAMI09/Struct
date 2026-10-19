const { open } = require('./secrets')
const { providerError } = require('./adapters')
const { getAdapter } = require('./registry')
async function dispatchIntegration(supabase, job, { dependencies = {} } = {}) {
  try {
    const { data: current, error } = await supabase
      .from('integration_definitions')
      .select('organization_id,credentials_encrypted,deleted_at')
      .eq('destination_id', job.destination_id)
      .eq('organization_id', job.organization_id)
      .maybeSingle()
    if (error)
      return {
        outcome: 'retry',
        category: 'database',
        detail: 'Integration credential lookup unavailable',
      }
    if (!current || current.deleted_at)
      return {
        outcome: 'dead',
        category: 'configuration',
        detail: 'Integration removed; delivery retained for inspection',
      }
    const secrets = open(
      current.credentials_encrypted,
      job.organization_id,
      job.destination_id,
    )
    return await getAdapter(job.integration_snapshot.kind).deliver(
      job.integration_snapshot,
      secrets,
      job.body,
      job,
      {
        dependencies,
      },
    )
  } catch (error) {
    return providerError(error)
  }
}
module.exports = { dispatchIntegration }
