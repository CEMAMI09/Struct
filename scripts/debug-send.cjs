#!/usr/bin/env node
// Production sender: credentials only from environment, never in diagnostics.
const fs=require('node:fs')
const {StructClient,SecureV2Client,PersistentSequenceCounter}=require('../sdk/js/index.cjs')
async function main(){
 if(process.argv.includes('--v2'))return sendV2()
 const [payloadFile,version='1',output='struct-device-outcome.json']=process.argv.slice(2)
 if(!payloadFile)throw new Error('Usage: node scripts/debug-send.cjs payload.bin schemaVersion [output.json]; configure STRUCT_HOST, STRUCT_KEY_ID, STRUCT_API_SECRET and optional STRUCT_ENCRYPTION_KEY')
 const payload=fs.readFileSync(payloadFile)
 const client=new StructClient({host:process.env.STRUCT_HOST,port:Number(process.env.STRUCT_PORT||8081),keyId:process.env.STRUCT_KEY_ID,apiSecret:process.env.STRUCT_API_SECRET,encryptionKey:process.env.STRUCT_ENCRYPTION_KEY})
 const result=await client.send(Number(version),payload,{confirmed:true})
 fs.writeFileSync(output,JSON.stringify({format:'struct-device-outcome-v1',mode:'production',created_at:new Date().toISOString(),...result},null,2))
 console.log(`Device outcome: ${result.status}; sanitized report: ${output}`)
}
async function sendV2(){
 const args=process.argv.slice(2).filter(arg=>arg!=='--v2'),value=flag=>args[args.indexOf(flag)+1]
 const payloadFile=args[0],slot=Number(args.includes('--slot')?value('--slot'):0),output=args.includes('--output')?value('--output'):'struct-device-outcome.json'
 if(!payloadFile||payloadFile.startsWith('--')||!process.env.STRUCT_COUNTER_FILE)throw new Error('V2 needs payload.bin, STRUCT_WIRE_DEVICE_ID, STRUCT_DEVICE_SECRET and STRUCT_COUNTER_FILE')
 const credentials={wireDeviceId:Number(process.env.STRUCT_WIRE_DEVICE_ID),rootSecret:process.env.STRUCT_DEVICE_SECRET}
 let counter
 try {
  if(args.includes('--bootstrap'))counter=await PersistentSequenceCounter.provision(process.env.STRUCT_COUNTER_FILE,{...credentials,bootstrapToken:process.env.STRUCT_BOOTSTRAP_TOKEN,bootstrapOrigin:process.env.STRUCT_BOOTSTRAP_ORIGIN||'https://www.usestruct.com'})
  else counter=new PersistentSequenceCounter(process.env.STRUCT_COUNTER_FILE,credentials)
  const client=new SecureV2Client({...credentials,counter,host:process.env.STRUCT_HOST||'ingest.usestruct.com',port:Number(process.env.STRUCT_PORT||8081)})
  const payload=fs.readFileSync(payloadFile),confirmed=args.includes('--confirmed')
  const outcomes=args.includes('--batch-count')?await client.sendBatch(slot,splitBatchFile(payload,Number(value('--batch-count'))),{confirmed}):[await client.send(slot,payload,{confirmed})]
  fs.writeFileSync(output,JSON.stringify({format:'struct-device-outcome-v1',mode:'production',created_at:new Date().toISOString(),...outcomes[0],...(outcomes.length>1?{envelopes:outcomes}:{})},null,2))
  for(const result of outcomes)console.log(`Struct Secure V2 · sequence ${result.sequence} · slot ${slot} · payload ${result.payload_bytes} B · frame ${result.frame_bytes} B · IPv4/UDP ${result.ipv4_udp_bytes} B · receipt ${result.receipt_bytes} B · ${result.status}`)
  console.log(`Sanitized report: ${output}`)
 }finally{counter?.close()}
}
function splitBatchFile(payload,count){
 if(!Number.isInteger(count)||count<1||count>65535||!payload.length||payload.length%count!==0)throw new Error('Batch file must contain equal-size records')
 const bytes=payload.length/count;return Array.from({length:count},(_,i)=>payload.subarray(i*bytes,(i+1)*bytes))
}
main().catch(()=>{console.error('Diagnostic send failed. Check usage, payload file, environment credentials and network; no receipt was confirmed.');process.exitCode=1})
