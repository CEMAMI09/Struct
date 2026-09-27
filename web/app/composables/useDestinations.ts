import type { Destination, RoutingRule, WebhookEventType } from '~/types'
import type { Json } from '~/types/database.types'

const DESTINATION_FIELDS = 'id,user_id,organization_id,name,device_id,routing_rule,event_types,enabled,created_at'

function routingRuleJson(rule: RoutingRule | null): Json {
  return rule ? { key: rule.key, operator: rule.operator, value: rule.value } : null
}

function normalizeDestination(row: any): Destination {
  return {
    id: row.id,
    user_id: row.user_id,
    organization_id: row.organization_id,
    name: row.name,
    url: null,
    device_id: row.device_id ?? null,
    routing_rule: row.routing_rule ?? null,
    event_types: row.event_types || ['telemetry.received'],
    enabled: !!row.enabled,
    created_at: row.created_at,
  }
}

const destinationsInflightByApp = new WeakMap<object, {
  promise: Promise<void> | null
  orgId: string | null
  generation: number
}>()

export function useDestinations() {
  const app = useNuxtApp()
  if (!destinationsInflightByApp.has(app)) destinationsInflightByApp.set(app, { promise: null, orgId: null, generation: 0 })
  const inflight = destinationsInflightByApp.get(app)!
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

    try {
      await ensureOrganization()
    } catch (e: any) {
      error.value = e.message || 'Failed to load destinations'
      return
    }
    const orgId = currentOrgId.value
    if (inflight.promise && inflight.orgId === orgId && !opts?.force) return inflight.promise
    const generation = ++inflight.generation

    if (loadedForOrg.value !== orgId) {
      destinations.value = []
      loadedForOrg.value = null
    }

    const run = async () => {
      const cacheHit = !!loadedForOrg.value && loadedForOrg.value === orgId
      if (!cacheHit) loading.value = true
      error.value = null
      try {
        if (!orgId) {
          destinations.value = []
          loadedForOrg.value = null
          return
        }

        const { data, error: err } = await supabase
          .from('destinations')
          .select(DESTINATION_FIELDS)
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })

        if (err) throw err
        if (generation !== inflight.generation || currentOrgId.value !== orgId) return
        destinations.value = (data || []).map(normalizeDestination)
        loadedForOrg.value = orgId
      } catch (e: any) {
        if (generation === inflight.generation && currentOrgId.value === orgId) {
          error.value = e.message || 'Failed to load destinations'
        }
      } finally {
        if (generation === inflight.generation) loading.value = false
      }
    }

    const promise = run().finally(() => {
      if (inflight.promise === promise) inflight.promise = null
    })
    inflight.promise = promise
    inflight.orgId = orgId
    return inflight.promise
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
        routing_rule: routingRuleJson(input.routing_rule || null),
        event_types: input.event_types?.length
          ? input.event_types
          : ['telemetry.received'],
        user_id: authData.user.id,
        organization_id,
        enabled: true,
      })
      .select(DESTINATION_FIELDS)
      .single()

    if (err) throw err
    const destination = normalizeDestination(data)
    destinations.value = [destination, ...destinations.value]
    return destination
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
      .select(DESTINATION_FIELDS)
      .single()

    if (err) throw err
    const updated = normalizeDestination(data)
    destinations.value = destinations.value.map((destination) =>
      destination.id === id ? updated : destination,
    )
    return updated
  }

  async function toggleDestination(id: string, enabled: boolean) {
    requireWrite()
    const { data, error: err } = await supabase
      .from('destinations')
      .update({ enabled })
      .eq('id', id)
      .select(DESTINATION_FIELDS)
      .single()
    if (err) throw err
    const updated = normalizeDestination(data)
    destinations.value = destinations.value.map((d) => d.id === id ? updated : d)
  }

  async function updateDestinationRoutingRule(id: string, routingRule: RoutingRule | null) {
    requireWrite()
    const organizationId = requireOrgId()
    const { data, error: err } = await supabase
      .from('destinations')
      .update({ routing_rule: routingRuleJson(routingRule) })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select(DESTINATION_FIELDS)
      .single()

    if (err) throw err
    const updated = normalizeDestination(data)
    destinations.value = destinations.value.map((destination) =>
      destination.id === id ? updated : destination,
    )
    return updated
  }

  async function getDestinationSigningSecret(id: string): Promise<string> {
    requireWrite()
    const { data, error: err } = await supabase.rpc('get_destination_signing_secret', {
      p_destination_id: id,
    })
    if (err) throw err
    if (typeof data !== 'string') throw new Error('Signing secret is not available')
    return data
  }

  async function getDestinationUrl(id: string): Promise<string> {
    requireWrite()
    const { data, error: err } = await supabase.rpc('get_destination_url', {
      p_destination_id: id,
    })
    if (err) throw err
    if (typeof data !== 'string') throw new Error('Endpoint URL is not available')
    return data
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
    getDestinationSigningSecret,
    getDestinationUrl,
    deleteDestination,
  }
}
