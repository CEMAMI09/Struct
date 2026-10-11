'use strict'
// Actual SecureV2Client retry implementation; local authenticated mock sink.
// Receipts here test delivery mechanics, NOT database persistence.
const fs=require('node:fs'),path=require('node:path'),dgram=require('node:dgram'),assert=require('node:assert/strict')
const {once}=require('node:events'),{randomBytes}=require('node:crypto')
const base=path.resolve(__dirname,'..'),root=path.resolve(base,'../..')
const wire=require(path.join(root,'sdk/js/secure-v2.cjs')),{SecureV2Client}=require(path.join(root,'sdk/js/secure-v2-client.cjs'))
const packed=require(path.join(root,'protocol/schema/bitpacked.cjs'))
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function timing(fn){for(let i=0;i<20;i++)fn();const samples=[];for(let i=0;i<1000;i++){const start=process.hrtime.bigint();fn();samples.push(Number(process.hrtime.bigint()-start))}samples.sort((a,b)=>a-b);return{median_ns:samples[500],p95_ns:samples[949],raw_sorted_ns:samples,warmups:20}}
async function main(){const results=[]
 for(const loss of [0,.001,.01,.02,.05,.1])for(const confirmed of [false,true]){
  let seed=20261010;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32}
  const secret=randomBytes(32),server=dgram.createSocket('udp4'),events=[],accepted=new Set();let sequence=0
  server.on('message',(frame,remote)=>{
   const drop=random()<loss;events.push({direction:'up',hex:frame.toString('hex'),dropped:drop,timestamp:performance.now()});if(drop)return
   const decoded=wire.decryptFrame(frame,secret);assert(decoded.plaintext.equals(Buffer.from('0000bc410000754201','hex')));accepted.add(decoded.sequence)
   if(decoded.confirmed){const receipt=wire.buildReceipt(secret,1,decoded.sequence),dropped=random()<loss;events.push({direction:'down',hex:receipt.toString('hex'),dropped,timestamp:performance.now()});if(!dropped)server.send(receipt,remote.port,remote.address)}
  })
  server.bind(0,'127.0.0.1');await once(server,'listening')
  const client=new SecureV2Client({wireDeviceId:1,rootSecret:secret,counter:{next:async()=>sequence++},host:'127.0.0.1',port:server.address().port})
  const n=confirmed?20:1000,outcomes=[];const start=performance.now()
  try{for(let i=0;i<n;i++){outcomes.push(await client.send(1,Buffer.from('0000bc410000754201','hex'),{confirmed,maxRetries:2,retryMs:1000,budgetMs:4500}));if(!confirmed&&!process.argv.includes('--burst'))await sleep(1)}await sleep(200)}finally{server.close()}
  const uplinks=events.filter(x=>x.direction==='up'),downlinks=events.filter(x=>x.direction==='down')
  const retrans=uplinks.length-new Set(uplinks.map(x=>x.hex)).size
  results.push({loss_probability:loss,confirmed,logical_readings:n,unique_readings_received:accepted.size,send_attempts:outcomes.reduce((sum,x)=>sum+x.attempts,0),
    server_unobserved_attempts:outcomes.reduce((sum,x)=>sum+x.attempts,0)-uplinks.length,pacing_ms:!confirmed&&!process.argv.includes('--burst')?1:0,
    responses_verified:outcomes.filter(x=>x.status==='committed').length,actual_dropped_datagrams:events.filter(x=>x.dropped).length,
    actual_retransmitted_datagrams:retrans,application_uplink_bytes:uplinks.reduce((sum,x)=>sum+x.hex.length/2,0),
    application_downlink_bytes:downlinks.reduce((sum,x)=>sum+x.hex.length/2,0),duration_ms:performance.now()-start,outcomes,observations:events,
    measurement_type:'measured',network_headers:'specification_calculated 28 bytes per observed UDP datagram; dropped attempts count as offered traffic',
    guarantee:'authenticated mock-sink acceptance; receipt is NOT a database-persistence test',seed:20261010,maxRetries:2,retryMs:1000,budgetMs:4500})
  console.log('Struct loss',loss,'confirmed',confirmed,'received',accepted.size,'/',n)
 }
 const schema=[{name:'temp',type:'float32'},{name:'humidity',type:'float32'},{name:'is_active',type:'boolean'}]
 const values={temp:23.5,humidity:61.25,is_active:true},payload=Buffer.from(packed.encodePayload(values,schema)),secret=randomBytes(32)
 let seq=0;const frame=wire.buildFrame({rootSecret:secret,wireDeviceId:1,sequence:seq++,payload})
 const performanceResults={scope:'host Node.js; not ESP32 CPU/radio/energy',node:process.version,
  encode:timing(()=>packed.encodePayload(values,schema)),decode:timing(()=>packed.decodePayload(payload,schema)),
  encrypt_and_frame_including_HKDF:timing(()=>wire.buildFrame({rootSecret:secret,wireDeviceId:1,sequence:seq++,payload})),
  decrypt_including_HKDF:timing(()=>wire.decryptFrame(frame,secret))}
 fs.writeFileSync(path.join(base,process.argv.includes('--burst')?'results/raw/struct-burst-overload.json':'results/raw/struct-impairment.json'),JSON.stringify({results,performance:performanceResults},null,2)+'\n')
}
main().catch(e=>{console.error(e);process.exitCode=1})
