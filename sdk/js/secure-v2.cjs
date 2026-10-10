'use strict'
// Authoritative Node Secure V2 wire format. Legacy protocol.cjs is unchanged.
const { hkdfSync, createCipheriv, createDecipheriv } = require('node:crypto')
const HEADER_BYTES = 9, TAG_BYTES = 16, FRAME_OVERHEAD = 25, RECEIPT_BYTES = 21
const GENERATION_MASK = 0xc0, UPLINK_GENERATION = 0x80, RECEIPT_CONTROL = 0xc0
const SLOT_MASK = 0x3c, RECEIPT_FLAG = 2, BATCH_FLAG = 1
const DEFAULT_MAX_FRAME_BYTES = 1200, MAX_FRAME_BYTES = 1400
const DEFAULT_INGEST_HOST = 'ingest.usestruct.com', DEFAULT_UDP_PORT = 8081
const HKDF_SALT = Buffer.from('struct-secure-v2/hkdf-sha256', 'ascii')
const LABELS = Object.freeze({uplinkKey:'struct-v2/uplink/key',downlinkKey:'struct-v2/downlink/key',uplinkPrefix:'struct-v2/uplink/nonce',downlinkPrefix:'struct-v2/downlink/nonce'})
function uint32(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`${name} must be uint32`)
  return value
}
function wireId(value) {
  if (uint32(value, 'wireDeviceId') === 0) throw new Error('Invalid Secure V2 wire device ID')
  return value
}
function rootBytes(root) {
  if (typeof root === 'string' && /^[a-fA-F0-9]{64}$/.test(root)) return Buffer.from(root, 'hex')
  if (Buffer.isBuffer(root) && root.length === 32) return root
  throw new Error('Root secret must be 32 bytes or 64 hex characters')
}
function maxFrameBytes(value = DEFAULT_MAX_FRAME_BYTES) {
  if (!Number.isInteger(value) || value < FRAME_OVERHEAD || value > MAX_FRAME_BYTES) throw new Error('Maximum frame size must be 25..1400')
  return value
}
function deriveKeys(root, wireDeviceId) {
  const id = Buffer.alloc(4); id.writeUInt32BE(wireId(wireDeviceId))
  const material = rootBytes(root), result = {}
  for (const [name,label] of Object.entries(LABELS)) {
    const info = Buffer.concat([Buffer.from(label, 'ascii'),Buffer.from([0,2]),id])
    result[name] = Buffer.from(hkdfSync('sha256', material, HKDF_SALT, info, name.endsWith('Key') ? 32 : 8))
  }
  return result
}
function nonce(prefix, sequence) {
  if (!Buffer.isBuffer(prefix) || prefix.length !== 8) throw new Error('Nonce prefix must be 8 bytes')
  const result = Buffer.alloc(12); prefix.copy(result); result.writeUInt32BE(uint32(sequence, 'sequence'),8)
  return result
}
function controlByte({slot=0,confirmed=false,batch=false}={}) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 15 || typeof confirmed !== 'boolean' || typeof batch !== 'boolean') throw new Error('Invalid Secure V2 control')
  return UPLINK_GENERATION | (slot << 2) | (confirmed ? RECEIPT_FLAG : 0) | (batch ? BATCH_FLAG : 0)
}
function isSecureV2(buf) { return Buffer.isBuffer(buf) && buf.length > 0 && (buf[0] & GENERATION_MASK) === UPLINK_GENERATION }
function parseHeader(buf, maximum = DEFAULT_MAX_FRAME_BYTES) {
  const max = maxFrameBytes(maximum)
  if (!isSecureV2(buf) || buf.length < FRAME_OVERHEAD || buf.length > max) throw new Error('Invalid Secure V2 frame')
  return {control:buf[0],wireDeviceId:wireId(buf.readUInt32BE(1)),sequence:buf.readUInt32BE(5),slot:(buf[0]&SLOT_MASK)>>>2,confirmed:!!(buf[0]&RECEIPT_FLAG),batch:!!(buf[0]&BATCH_FLAG),aad:buf.subarray(0,HEADER_BYTES)}
}
function seal(key, iv, aad, plaintext) {
  const cipher = createCipheriv('chacha20-poly1305',key,iv,{authTagLength:TAG_BYTES})
  cipher.setAAD(aad,{plaintextLength:plaintext.length})
  return {ciphertext:Buffer.concat([cipher.update(plaintext),cipher.final()]),tag:cipher.getAuthTag()}
}
function open(key, iv, aad, ciphertext, tag) {
  try {
    const cipher = createDecipheriv('chacha20-poly1305',key,iv,{authTagLength:TAG_BYTES})
    cipher.setAAD(aad,{plaintextLength:ciphertext.length}); cipher.setAuthTag(tag)
    // No plaintext is returned until final authenticates successfully.
    return Buffer.concat([cipher.update(ciphertext),cipher.final()])
  } catch { throw new Error('Secure V2 authentication failed') }
}
function buildFrame({rootSecret,wireDeviceId,sequence,slot=0,confirmed=false,batch=false,payload,maximum=DEFAULT_MAX_FRAME_BYTES}) {
  if (!Buffer.isBuffer(payload)) throw new Error('Payload must be a Buffer')
  if (payload.length + FRAME_OVERHEAD > maxFrameBytes(maximum)) throw new Error('Secure V2 frame exceeds maximum')
  const aad=Buffer.alloc(HEADER_BYTES);aad[0]=controlByte({slot,confirmed,batch})
  aad.writeUInt32BE(wireId(wireDeviceId),1);aad.writeUInt32BE(uint32(sequence,'sequence'),5)
  const keys=deriveKeys(rootSecret,wireDeviceId), encrypted=seal(keys.uplinkKey,nonce(keys.uplinkPrefix,sequence),aad,payload)
  return Buffer.concat([aad,encrypted.ciphertext,encrypted.tag])
}
function decryptFrame(frame,rootSecret,maximum=DEFAULT_MAX_FRAME_BYTES) {
  const header=parseHeader(frame,maximum), keys=deriveKeys(rootSecret,header.wireDeviceId)
  const plaintext=open(keys.uplinkKey,nonce(keys.uplinkPrefix,header.sequence),header.aad,frame.subarray(HEADER_BYTES,-TAG_BYTES),frame.subarray(-TAG_BYTES))
  return {...header,plaintext}
}
function buildReceipt(rootSecret,wireDeviceId,sequence) {
  const aad=Buffer.alloc(5);aad[0]=RECEIPT_CONTROL;aad.writeUInt32BE(uint32(sequence,'sequence'),1)
  const keys=deriveKeys(rootSecret,wireDeviceId)
  return Buffer.concat([aad,seal(keys.downlinkKey,nonce(keys.downlinkPrefix,sequence),aad,Buffer.alloc(0)).tag])
}
function verifyReceipt(receipt,rootSecret,wireDeviceId,sequence) {
  if (!Buffer.isBuffer(receipt) || receipt.length !== RECEIPT_BYTES || receipt[0] !== RECEIPT_CONTROL || receipt.readUInt32BE(1) !== sequence) return false
  try {
    const keys=deriveKeys(rootSecret,wireDeviceId)
    open(keys.downlinkKey,nonce(keys.downlinkPrefix,sequence),receipt.subarray(0,5),Buffer.alloc(0),receipt.subarray(5))
    return true
  } catch { return false }
}
function buildBatch(records,maximum=DEFAULT_MAX_FRAME_BYTES) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 255 || !Buffer.isBuffer(records[0]) || !records[0].length || records.some(r=>!Buffer.isBuffer(r)||r.length!==records[0].length)) throw new Error('Batch requires 1..255 equal nonempty records')
  if (1+records.length*records[0].length+FRAME_OVERHEAD>maxFrameBytes(maximum)) throw new Error('Secure V2 batch exceeds maximum')
  const payload=Buffer.concat([Buffer.from([records.length]),...records])
  return payload
}
function splitBatch(records,maximum=DEFAULT_MAX_FRAME_BYTES) {
  if (!Array.isArray(records) || !records.length || !Buffer.isBuffer(records[0]) || !records[0].length || records.some(r=>!Buffer.isBuffer(r)||r.length!==records[0].length)) throw new Error('Invalid batch records')
  const count=Math.min(255,Math.floor((maxFrameBytes(maximum)-FRAME_OVERHEAD-1)/records[0].length))
  if (count<1) throw new Error('A batch record exceeds maximum')
  const batches=[];for(let i=0;i<records.length;i+=count)batches.push(buildBatch(records.slice(i,i+count),maximum))
  return batches
}
function splitRecords(plaintext,{batch,recordBytes}) {
  if (!Buffer.isBuffer(plaintext) || !Number.isInteger(recordBytes) || recordBytes<1 || recordBytes>MAX_FRAME_BYTES-FRAME_OVERHEAD) throw new Error('Invalid schema record size')
  const count=batch?plaintext[0]:1, offset=batch?1:0
  if (!count || plaintext.length!==offset+count*recordBytes) throw new Error('Invalid Secure V2 payload length')
  return Array.from({length:count},(_,i)=>plaintext.subarray(offset+i*recordBytes,offset+(i+1)*recordBytes))
}
module.exports={HEADER_BYTES,TAG_BYTES,FRAME_OVERHEAD,RECEIPT_BYTES,GENERATION_MASK,UPLINK_GENERATION,RECEIPT_CONTROL,SLOT_MASK,RECEIPT_FLAG,BATCH_FLAG,DEFAULT_MAX_FRAME_BYTES,MAX_FRAME_BYTES,DEFAULT_INGEST_HOST,DEFAULT_UDP_PORT,HKDF_SALT,LABELS,uint32,wireId,rootBytes,maxFrameBytes,deriveKeys,nonce,controlByte,isSecureV2,parseHeader,buildFrame,decryptFrame,buildReceipt,verifyReceipt,buildBatch,splitBatch,splitRecords}
