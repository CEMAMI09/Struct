import type { Destination, RoutingRule, WebhookEventType } from '~/types'

import type { Destination, RoutingRule, WebhookEventType } from '~/types'

let destinationsInflight: Promise<void> | null = null

export function useDestinations() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const { currentOrgId, requireOrgId, requireWrite, ensureOrganization } = useOrganization()

  const destinations = useState<Destination[]>('destinations', () => [])
  const loading = useState('destinations-loading', () => false)
  const error = useState<string | null>('destinations-error', () => null)
  const loadedForOrg = useState<string | null>('destinations-loaded-org', () => null)

  async function hasAuth(): Promise<boolean> {
    if (user.value) return true
    const { data } = await supabase.auth.getSession()
    return !!data.session?.user
  }

  async function fetchDestinations(opts?: { force?: boolean }) {
    if (!(await hasAuth())) return

    if (destinationsInflight && !opts?.force) {
      return destinationsInflight
    }

    const run = async () => {
      const cacheHit = !!loadedForOrg.value && loadedForOrg.value === currentOrgId.value
      if (!cacheHit) loading.value = true
      error.value = null
      try {
        await ensureOrganization()
        const orgId = currentOrgId.value
        if (!orgId) {
          destinations.value = []
          loadedForOrg.value = null
          return
        }

        const { data, error: err } = await supabase
          .from('destinations')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })

        if (err) throw err
        destinations.value = (data || []) as Destination[]
        loadedForOrg.value = orgId
      } catch (e: any) {
        error.value = e.message || 'Failed to load destinations'
      } finally {
        loading.value = false
      }
    }

    destinationsInflight = run().finally(() => {
      destinationsInflight = null
    })
    return destinationsInflight
  }

  function invalidateDestinationCache() {
    loadedForOrg.value = null
  }

  async function createDestination(input: {
    name: string
    url: string
    device_id?: string | null
    routing_rule?: RoutingRule | null
    event_types?: WebhookEventType[]
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
        event_types: input.event_types?.length
          ? input.event_types
          : ['telemetry.received'],
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

  async function updateDestinationEvents(
    id: string,
    eventTypes: WebhookEventType[],
  ) {
    requireWrite()
    const organizationId = requireOrgId()
    if (!eventTypes.length) throw new Error('Select at least one webhook event')

    const { data, error: err } = await supabase
      .from('destinations')
      .update({ event_types: eventTypes })
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
    invalidateDestinationCache,
    createDestination,
    updateDestinationEvents,
    toggleDestination,
    updateDestinationRoutingRule,
    deleteDestination,
  }
}
