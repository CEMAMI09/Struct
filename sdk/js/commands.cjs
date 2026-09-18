const { createHmac, timingSafeEqual } = require('node:crypto')
const mac = (key, body) => createHmac('sha256', key).update(body).digest()
// Inner envelope: STRC4 + key_id16 + command_id16 + issued4 + expires4 + payload + HMAC32.
function buildCommand({ keyId, secret, commandId, issued, expires, payload }) {
  if (!/^[!-~]{16}$/.test(keyId) || !/^[a-fA-F0-9]{64}$/.test(secret) ||
      !Buffer.isBuffer(commandId) || commandId.length!==16 || !Buffer.isBuffer(payload) ||
      !payload.length || payload.length>1324 || !Number.isInteger(issued) || !Number.isInteger(expires) ||
      issued<0 || expires<=issued || expires>0xffffffff) throw new Error('Invalid command')
  const header=Buffer.alloc(44); header.write('STRC'); header.write(keyId,4); commandId.copy(header,20)
  header.writeUInt32LE(issued,36); header.writeUInt32LE(expires,40)
  const body=Buffer.concat([header,payload]); return Buffer.concat([body,mac(secret,body)])
}
function verifyCommand(frame, { keyId, secret, now = Math.floor(Date.now()/1000), allowExpired = false }) {
  if (!Buffer.isBuffer(frame) || frame.length<77 || frame.length>1400 ||
      frame.subarray(0,4).toString()!=='STRC' || frame.subarray(4,20).toString()!==keyId ||
      !timingSafeEqual(frame.subarray(-32),mac(secret,frame.subarray(0,-32)))) throw new Error('Invalid command authentication')
  const expired=frame.readUInt32LE(40)<=now
  if (!Number.isInteger(now) || now<0 || frame.readUInt32LE(36)>now+60 || (expired&&!allowExpired) || frame.readUInt32LE(40)<=frame.readUInt32LE(36)) throw new Error('Command expired or clock invalid')
  return { commandId: frame.subarray(20,36).toString('hex'), expires:frame.readUInt32LE(40), expired, payload:frame.subarray(44,-32) }
}
module.exports={buildCommand,verifyCommand}
