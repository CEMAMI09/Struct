#!/usr/bin/env node
// Deterministic TEST ONLY keys. Fixture never contains production credentials.
const fs=require('node:fs'),path=require('node:path')
const v2=require('../sdk/js/secure-v2.cjs')
const rootSecret=Array.from({length:32},(_,i)=>i.toString(16).padStart(2,'0')).join('')
const wireDeviceId=0x12345678
const definitions=[
  {name:'normal-legacy-nine',sequence:42,slot:0,payloadHex:'000090420000274201'},
  {name:'minimum-sequence',sequence:0,slot:1,payloadHex:'00'},
  {name:'maximum-sequence',sequence:0xffffffff,slot:15,payloadHex:'ff'},
  {name:'empty-crypto-only',sequence:7,slot:0,payloadHex:''},
  {name:'packed-environmental-three',sequence:43,slot:2,payloadHex:'8c8d14',values:{temperature:72.4,humidity:41.8,active:true},schema:[{name:'temperature',type:'fixed',min:-40,max:125,precision:0.1},{name:'humidity',type:'fixed',min:0,max:100,precision:0.1},{name:'active',type:'boolean'}]},
  {name:'batch-two',sequence:44,slot:0,batch:true,payloadHex:'02000090420000274201000092420000294200'},
  {name:'confirmed',sequence:45,slot:0,confirmed:true,payloadHex:'000090420000274201'},
]
const vectors=definitions.map(def=>{
 const payload=Buffer.from(def.payloadHex,'hex'),keys=v2.deriveKeys(rootSecret,wireDeviceId)
 const frame=v2.buildFrame({...def,wireDeviceId,rootSecret,payload})
 return {...def,rootSecret,wireDeviceId,control:frame[0],keys:Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,v.toString('hex')])),nonce:v2.nonce(keys.uplinkPrefix,def.sequence).toString('hex'),downlinkNonce:v2.nonce(keys.downlinkPrefix,def.sequence).toString('hex'),aad:frame.subarray(0,9).toString('hex'),plaintext:def.payloadHex,ciphertext:frame.subarray(9,-16).toString('hex'),tag:frame.subarray(-16).toString('hex'),frame:frame.toString('hex'),receipt:v2.buildReceipt(rootSecret,wireDeviceId,def.sequence).toString('hex')}
})
const output=path.join(__dirname,'../sdk/tests/secure-v2-vectors.json')
fs.writeFileSync(output,JSON.stringify({format:'struct-secure-v2-vectors-v1',warning:'TEST ONLY credentials. Never use for a real device.',vectors},null,2)+'\n')
console.log('Generated canonical Secure V2 test vectors')
