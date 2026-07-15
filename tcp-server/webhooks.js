/**
 * Fan-out parsed telemetry to user-configured webhook destinations.
 */

async function loadDestinations(supabase, userId, deviceId, organizationId) {
  let canUseRouting = false
  if (organizationId) {
    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('subscription_tier')
      .eq('id', organizationId)
      .maybeSingle()

    if (organizationError) {
      console.warn(`[struct] organization tier lookup failed: ${organizationError.message}`)
    } else {
      canUseRouting = organization?.subscription_tier === 'scale'
    }
  }

  let query = supabase
    .from('destinations')
    .select('id, name, url, device_id, enabled, routing_rule')
    .eq('enabled', true)

  query = organizationId
    ? query.eq('organization_id', organizationId)
    : query.eq('user_id', userId)

  const { data, error } = await query

  if (error) {
    console.warn(`[struct] destinations lookup failed: ${error.message}`)
    return []
  }

  return (data || [])
    .filter((d) => !d.device_id || d.device_id === deviceId)
    .map((destination) => ({
      ...destination,
      // Downgrading from Scale restores basic unconditional webhooks.
      routing_rule: canUseRouting ? destination.routing_rule : null,
    }))
}

/**
 * Evaluate one destination rule against the parsed telemetry object.
 * A missing rule preserves unconditional delivery. Invalid rules and missing
 * payload keys fail closed so they cannot accidentally fan out data.
 *
 * @param {Record<string, unknown>} payload
 * @param {{ key?: unknown, operator?: unknown, value?: unknown } | null} rule
 */
function matchesRoutingRule(payload, rule) {
  if (rule == null) return true
  if (
    typeof rule !== 'object' ||
    Array.isArray(rule) ||
    typeof rule.key !== 'string' ||
    !rule.key ||
    !Object.prototype.hasOwnProperty.call(rule, 'value') ||
    !Object.prototype.hasOwnProperty.call(payload, rule.key)
  ) {
    return false
  }

  const actual = payload[rule.key]
  const expected = rule.value

  switch (rule.operator) {
    case '==':
      return actual === expected
    case '!=':
      return actual !== expected
    case '>':
    case '>=':
    case '<':
    case '<=': {
      const left = Number(actual)
      const right = Number(expected)
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false
      if (rule.operator === '>') return left > right
      if (rule.operator === '>=') return left >= right
      if (rule.operator === '<') return left < right
      return left <= right
    }
    default:
      return false
  }
}

async function fireWebhook(dest, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(dest.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Struct-Gateway/0.1',
        'x-struct-destination': dest.id,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.warn(`[struct] webhook ${dest.name} → HTTP ${res.status}`)
    } else {
      console.log(`[struct] webhook ✓ ${dest.name}`)
    }
  } catch (err) {
    console.warn(`[struct] webhook ${dest.name} failed: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ id: string, name: string, user_id: string, organization_id?: string }} device
 * @param {Record<string, unknown>} parsed
 */
async function dispatchWebhooks(supabase, device, parsed) {
  const destinations = await loadDestinations(
    supabase,
    device.user_id,
    device.id,
    device.organization_id,
  )
  if (!destinations.length) return

  const body = {
    device_id: device.id,
    device_name: device.name,
    timestamp: new Date().toISOString(),
    payload: parsed,
  }

  const matched = destinations.filter((destination) => {
    const matches = matchesRoutingRule(parsed, destination.routing_rule)
    if (!matches && destination.routing_rule) {
      console.log(`[struct] webhook skipped by routing rule: ${destination.name}`)
    }
    return matches
  })

  await Promise.allSettled(matched.map((d) => fireWebhook(d, body)))
}

module.exports = {
  dispatchWebhooks,
  loadDestinations,
  fireWebhook,
  matchesRoutingRule,
}
