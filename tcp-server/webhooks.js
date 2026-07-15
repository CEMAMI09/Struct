/**
 * Fan-out parsed telemetry to user-configured webhook destinations.
 */
const crypto = require('crypto')

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
    .select('id, name, url, device_id, enabled, routing_rule, event_types, signing_secret')
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

function signWebhookBody(secret, serializedBody) {
  if (!secret) return ''
  return `sha256=${crypto
    .createHmac('sha256', secret)
    .update(serializedBody)
    .digest('hex')}`
}

async function fireWebhook(dest, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const serialized = JSON.stringify(body)
    const signature = signWebhookBody(dest.signing_secret, serialized)
    const res = await fetch(dest.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Struct-Gateway/0.1',
        'x-struct-destination': dest.id,
        'x-struct-event': body.type,
        ...(signature ? { 'x-struct-signature': signature } : {}),
      },
      body: serialized,
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
    type: 'telemetry.received',
    device_id: device.id,
    device_name: device.name,
    timestamp: new Date().toISOString(),
    payload: parsed,
  }

  const matched = destinations.filter((destination) => {
    if (!(destination.event_types || ['telemetry.received']).includes(body.type)) {
      return false
    }
    const matches = matchesRoutingRule(parsed, destination.routing_rule)
    if (!matches && destination.routing_rule) {
      console.log(`[struct] webhook skipped by routing rule: ${destination.name}`)
    }
    return matches
  })

  await Promise.allSettled(matched.map((d) => fireWebhook(d, body)))
}

async function dispatchDeviceEvent(supabase, device, type) {
  const destinations = await loadDestinations(
    supabase,
    device.user_id,
    device.id,
    device.organization_id,
  )
  const matched = destinations.filter((destination) =>
    (destination.event_types || ['telemetry.received']).includes(type),
  )
  if (!matched.length) return

  const body = {
    type,
    device_id: device.id,
    device_name: device.name,
    timestamp: new Date().toISOString(),
  }
  await Promise.allSettled(matched.map((d) => fireWebhook(d, body)))
}

module.exports = {
  dispatchWebhooks,
  dispatchDeviceEvent,
  loadDestinations,
  fireWebhook,
  matchesRoutingRule,
  signWebhookBody,
}
