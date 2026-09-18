#!/usr/bin/env node
// Production sender: credentials only from environment, never in diagnostics.
const fs=require('node:fs')
const {StructClient}=require('../sdk/js/index.cjs')
async function main(){
 const [payloadFile,version='1',output='struct-device-outcome.json']=process.argv.slice(2)
 if(!payloadFile)throw new Error('Usage: node scripts/debug-send.cjs payload.bin schemaVersion [output.json]; configure STRUCT_HOST, STRUCT_KEY_ID, STRUCT_API_SECRET and optional STRUCT_ENCRYPTION_KEY')
 const payload=fs.readFileSync(payloadFile)
 const client=new StructClient({host:process.env.STRUCT_HOST,port:Number(process.env.STRUCT_PORT||8081),keyId:process.env.STRUCT_KEY_ID,apiSecret:process.env.STRUCT_API_SECRET,encryptionKey:process.env.STRUCT_ENCRYPTION_KEY})
 const result=await client.send(Number(version),payload,{confirmed:true})
 fs.writeFileSync(output,JSON.stringify({format:'struct-device-outcome-v1',mode:'production',created_at:new Date().toISOString(),...result},null,2))
 console.log(`Device outcome: ${result.status}; sanitized report: ${output}`)
}
main().catch(()=>{console.error('Diagnostic send failed. Check usage, payload file, environment credentials and network; no receipt was confirmed.');process.exitCode=1})
