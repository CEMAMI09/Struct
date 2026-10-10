#!/usr/bin/env node
// Exact Struct application sizes. IP/UDP estimates exclude link/radio/retries.
const packed=require('../protocol/schema/bitpacked.cjs'),legacy=require('../tcp-server/parser')
const wire=require('../sdk/js/secure-v2.cjs')
const samples=[
 {name:'environmental-basic',values:{temperature:72.4,humidity:41.8,active:true},legacy:[{name:'temperature',type:'float32'},{name:'humidity',type:'float32'},{name:'active',type:'boolean'}],optimized:[{name:'temperature',type:'fixed',min:-40,max:125,precision:0.1},{name:'humidity',type:'fixed',min:0,max:100,precision:0.1},{name:'active',type:'boolean'}]},
 {name:'eight-booleans',values:Object.fromEntries(Array.from({length:8},(_,i)=>['flag'+i,i%2===0])),legacy:Array.from({length:8},(_,i)=>({name:'flag'+i,type:'boolean'})),optimized:Array.from({length:8},(_,i)=>({name:'flag'+i,type:'boolean'}))},
]
for(const sample of samples){
 const encoded=Buffer.from(packed.encodePayload(sample.values,sample.optimized)),count=10
 const batch=wire.buildBatch(Array.from({length:count},()=>encoded)),batchFrame=batch.length+25
 console.log(`schema: ${sample.name}\n  JSON payload: ${Buffer.byteLength(JSON.stringify(sample.values))} B\n  legacy Struct payload: ${legacy.schemaByteLength(sample.legacy)} B\n  V2 optimized payload: ${encoded.length} B (${packed.compileSchema(sample.optimized).bits} bits)\n  V2 secure frame: ${encoded.length+25} B\n  IPv4 + UDP estimate: ${encoded.length+53} B\n  confirmed receipt: 21 B application; 49 B including IPv4/UDP\n  batch of ${count}: ${batchFrame} B application; ${batchFrame+28} B including IPv4/UDP\n  effective application bytes/reading: ${(batchFrame/count).toFixed(2)} B\n  effective IPv4/UDP bytes/reading: ${((batchFrame+28)/count).toFixed(2)} B\n`)
}
