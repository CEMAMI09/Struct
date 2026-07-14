/**
 * Downlink delivery — push pending packed commands back to the device over TCP.
 *
 * Frame written to socket:
 *   [uint16 LE length][packed command bytes…]
 */

async function fetchPendingCommands(supabase, deviceId, limit = 8) {
  const { data, error } = await supabase
    .from('pending_commands')
    .select('id, packed_hex, command_type')
    .eq('device_id', deviceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.warn(`[struct] pending_commands fetch failed: ${error.message}`)
    return []
  }
  return data || []
}

async function markDelivered(supabase, ids) {
  if (!ids.length) return
  const { error } = await supabase
    .from('pending_commands')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .in('id', ids)

  if (error) {
    console.warn(`[struct] mark delivered failed: ${error.message}`)
  }
}

/**
 * Encode one command as length-prefixed frame and write to socket.
 * @param {import('net').Socket} socket
 * @param {string} packedHex
 */
function writeCommandFrame(socket, packedHex) {
  const payload = Buffer.from(packedHex, 'hex')
  if (!payload.length) return
  const header = Buffer.alloc(2)
  header.writeUInt16LE(payload.length, 0)
  socket.write(Buffer.concat([header, payload]))
}

/**
 * After a successful uplink, flush pending downlinks to the same socket.
 */
async function deliverPendingDownlinks(supabase, socket, deviceId) {
  const pending = await fetchPendingCommands(supabase, deviceId)
  if (!pending.length) return 0

  const delivered = []
  for (const cmd of pending) {
    try {
      writeCommandFrame(socket, cmd.packed_hex)
      delivered.push(cmd.id)
      console.log(`[struct] ↓ downlink ${cmd.command_type} → device ${deviceId.slice(0, 8)}…`)
    } catch (err) {
      console.warn(`[struct] downlink write failed: ${err.message}`)
      break
    }
  }

  await markDelivered(supabase, delivered)
  return delivered.length
}

module.exports = {
  fetchPendingCommands,
  deliverPendingDownlinks,
  writeCommandFrame,
  markDelivered,
}
