import type { Destination, RoutingRule } from '~/types'

export function useDestinations() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const { currentOrgId, requireOrgId, requireWrite, ensureOrganization } = useOrganization()

  const destinations = useState<Destination[]>('destinations', () => [])
  const loading = useState('destinations-loading', () => false)
  const error = useState<string | null>('destinations-error', () => null)

  async function fetchDestinations() {
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user && !user.value) return

    loading.value = true
    error.value = null
    try {
      await ensureOrganization()
      const orgId = currentOrgId.value
      if (!orgId) {
        destinations.value = []
        return
      }

      const { data, error: err } = await supabase
        .from('destinations')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })

      if (err) throw err
      destinations.value = (data || []) as Destination[]
    } catch (e: any) {
      error.value = e.message || 'Failed to load destinations'
    } finally {
      loading.value = false
    }
  }

  async function createDestination(input: {
    name: string
    url: string
    device_id?: string | null
    routing_rule?: RoutingRule | null
  }) {
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
      throw new Error('Not authenticated — sign out and sign in again')
    }

    await ensureOrganization()
    requireWrite()
    const organization_id = requireOrgId()

    const { data, error: err } = await supabase
      .from('destinations')
      .insert({
        name: input.name,
        url: input.url,
        device_id: input.device_id || null,
        routing_rule: input.routing_rule || null,
        user_id: authData.user.id,
        organization_id,
        enabled: true,
      })
      .select()
      .single()

    if (err) throw err
    destinations.value = [data as Destination, ...destinations.value]
    return data as Destination
  }

  async function toggleDestination(id: string, enabled: boolean) {
    requireWrite()
    const { data, error: err } = await supabase
      .from('destinations')
      .update({ enabled })
      .eq('id', id)
      .select()
      .single()
    if (err) throw err
    destinations.value = destinations.value.map((d) =>
      d.id === id ? (data as Destination) : d,
    )
  }

  async function updateDestinationRoutingRule(id: string, routingRule: RoutingRule | null) {
    requireWrite()
    const organizationId = requireOrgId()
    const { data, error: err } = await supabase
      .from('destinations')
      .update({ routing_rule: routingRule })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single()

    if (err) throw err
    destinations.value = destinations.value.map((destination) =>
      destination.id === id ? (data as Destination) : destination,
    )
    return data as Destination
  }

  async function deleteDestination(id: string) {
    requireWrite()
    const { error: err } = await supabase.from('destinations').delete().eq('id', id)
    if (err) throw err
    destinations.value = destinations.value.filter((d) => d.id !== id)
  }

  return {
    destinations,
    loading,
    error,
    fetchDestinations,
    createDestination,
    toggleDestination,
    updateDestinationRoutingRule,
    deleteDestination,
  }
}
