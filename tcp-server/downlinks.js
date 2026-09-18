/**
 * Downlink delivery with claim/send/ack lifecycle (Protocol v2).
 */


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

function writeDownlinkFrame(socket, command, device) {
  const hex = String(command.command_id).replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex) || !/^(?:[0-9a-fA-F]{2})+$/.test(command.packed_hex)) throw new Error('Invalid command bytes')
  const inner = require('../sdk/js/commands.cjs').buildCommand({
    keyId: device.key_id, secret: require('./auth').decryptSecret(device.api_secret_encrypted),
    commandId: Buffer.from(hex, 'hex'), payload: Buffer.from(command.packed_hex, 'hex'),
    issued: Math.floor(new Date(command.created_at).getTime()/1000),
    expires: Math.floor(new Date(command.expires_at).getTime()/1000),
  })
  const prefix = Buffer.alloc(2); prefix.writeUInt16LE(inner.length)
  return new Promise((resolve, reject) => socket.write(Buffer.concat([prefix,inner]), err => err ? reject(err) : resolve()))
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
    .eq('status', 'claimed')
    .eq('claimed_by', GATEWAY_ID)

  if (error) {
    console.warn(`[struct] mark sent failed: ${error.message}`)
  }
}

async function deliverPendingDownlinks(supabase, socket, deviceId) {
  const { data: device, error } = await supabase.from('devices').select('key_id,api_secret_encrypted').eq('id',deviceId).maybeSingle()
  if (error || !device) return 0
  const pending = await claimPendingCommands(supabase, deviceId)
  if (!pending.length) return 0

  const sent = []
  for (const cmd of pending) {
    try {
      await writeDownlinkFrame(socket, cmd, device)
      sent.push(cmd.id)
      console.log(
        `[struct] ↓ downlink ${cmd.command_type} (${cmd.command_id}) → device ${deviceId.slice(0, 8)}…`,
      )
    } catch (err) {
      console.warn(`[struct] downlink write failed: ${err.message}`)
      await supabase
        .from('pending_commands')
        .update({
          // A write error cannot prove that the peer received no bytes.
          status: 'sent',
          last_error: err.message,
          next_attempt_at: new Date(Date.now() + 5_000).toISOString(),
          lease_expires_at: new Date(Date.now() + 5_000).toISOString(),
        })
        .eq('id', cmd.id)
        .eq('status', 'claimed')
        .eq('claimed_by', GATEWAY_ID)
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
