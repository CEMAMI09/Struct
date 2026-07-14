/**
 * Fan-out parsed telemetry to user-configured webhook destinations.
 */

async function loadDestinations(supabase, userId, deviceId) {
  const { data, error } = await supabase
    .from('destinations')
    .select('id, name, url, device_id, enabled')
    .eq('user_id', userId)
    .eq('enabled', true)

  if (error) {
    console.warn(`[struct] destinations lookup failed: ${error.message}`)
    return []
  }

  return (data || []).filter((d) => !d.device_id || d.device_id === deviceId)
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
 * @param {{ id: string, name: string, user_id: string }} device
 * @param {Record<string, unknown>} parsed
 */
async function dispatchWebhooks(supabase, device, parsed) {
  const destinations = await loadDestinations(supabase, device.user_id, device.id)
  if (!destinations.length) return

  const body = {
    device_id: device.id,
    device_name: device.name,
    timestamp: new Date().toISOString(),
    payload: parsed,
  }

  await Promise.allSettled(destinations.map((d) => fireWebhook(d, body)))
}

module.exports = { dispatchWebhooks, loadDestinations, fireWebhook }
