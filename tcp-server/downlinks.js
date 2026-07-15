/**
 * Downlink delivery with claim/send/ack lifecycle (Protocol v2).
 */
const { buildDownlinkFrame } = require('./protocol')

const GATEWAY_ID =
  process.env.TCP_GATEWAY_ID ||
  `gw-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

async function claimPendingCommands(supabase, deviceId, limit = 8) {
  const { data, error } = await supabase.rpc('claim_pending_downlinks', {
    p_device_id: deviceId,
    p_gateway_id: GATEWAY_ID,
    p_limit: limit,
  })

  if (error) {
    console.warn(`[struct] claim_pending_downlinks failed: ${error.message}`)
    return []
  }
  return data || []
}

function writeDownlinkFrame(socket, commandId, packedHex) {
  const commandUuid = Buffer.alloc(16)
  if (typeof commandId === 'string') {
    const hex = commandId.replace(/-/g, '')
    if (hex.length !== 32) {
      throw new Error(`Invalid command_id: ${commandId}`)
    }
    Buffer.from(hex, 'hex').copy(commandUuid)
  } else if (Buffer.isBuffer(commandId)) {
    commandId.copy(commandUuid, 0, 0, 16)
  } else {
    throw new Error('command_id must be uuid string or 16-byte buffer')
  }

  const frame = buildDownlinkFrame(commandUuid, packedHex)
  return new Promise((resolve, reject) => {
    socket.write(frame, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function markSent(supabase, ids) {
  if (!ids.length) return
  const { error } = await supabase
    .from('pending_commands')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
    })
    .in('id', ids)

  if (error) {
    console.warn(`[struct] mark sent failed: ${error.message}`)
  }
}

async function deliverPendingDownlinks(supabase, socket, deviceId) {
  const pending = await claimPendingCommands(supabase, deviceId)
  if (!pending.length) return 0

  const sent = []
  for (const cmd of pending) {
    try {
      await writeDownlinkFrame(socket, cmd.command_id, cmd.packed_hex)
      sent.push(cmd.id)
      console.log(
        `[struct] ↓ downlink ${cmd.command_type} (${cmd.command_id}) → device ${deviceId.slice(0, 8)}…`,
      )
    } catch (err) {
      console.warn(`[struct] downlink write failed: ${err.message}`)
      await supabase
        .from('pending_commands')
        .update({
          status: 'pending',
          last_error: err.message,
          next_attempt_at: new Date(Date.now() + 5_000).toISOString(),
          lease_expires_at: null,
        })
        .eq('id', cmd.id)
      break
    }
  }

  await markSent(supabase, sent)
  return sent.length
}

module.exports = {
  GATEWAY_ID,
  claimPendingCommands,
  deliverPendingDownlinks,
  writeDownlinkFrame,
}
