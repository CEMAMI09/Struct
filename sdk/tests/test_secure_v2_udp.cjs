const assert=require('node:assert/strict'),dgram=require('node:dgram'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {once}=require('node:events'),{execFile}=require('node:child_process'),{promisify}=require('node:util')
const runCommand=promisify(execFile),wire=require('../js/secure-v2.cjs')
const {SecureV2Client,PersistentSequenceCounter}=require('../js/index.cjs')
async function run(){
 const server=dgram.createSocket('udp4'),rootSecret='21'.repeat(32),wireDeviceId=201,frames=[]
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'struct-v2-debug-'))
 let nextSequence=0,mode='retry'
 const counter={wireDeviceId,next:()=>nextSequence++}
 server.on('message',(frame,remote)=>{
  const parsed=wire.decryptFrame(frame,rootSecret);frames.push(Buffer.from(frame))
  if(!parsed.confirmed||mode==='timeout')return
  const receipt=wire.buildReceipt(rootSecret,wireDeviceId,parsed.sequence)
  if(mode==='retry'&&frames.length===1)receipt[20]^=1
  server.send(receipt,remote.port,remote.address)
 })
 server.bind(0,'127.0.0.1');await once(server,'listening')
 const client=new SecureV2Client({wireDeviceId,rootSecret,counter,host:'127.0.0.1',port:server.address().port})
 try {
  await assert.rejects(client.send(16,Buffer.from([1])),/control/);assert.equal(nextSequence,0)
  const pending=client.send(0,Buffer.from([42]),{confirmed:true,maxRetries:1,retryMs:1000,budgetMs:2400})
  await assert.rejects(client.send(0,Buffer.from([43])),/in flight/)
  const confirmed=await pending
  assert.equal(confirmed.status,'committed');assert.equal(confirmed.attempts,2);assert.equal(confirmed.sequence,0)
  assert.equal(frames.length,2);assert(frames[0].equals(frames[1]),'retry must resend identical AEAD bytes')
  mode='timeout';const unknown=await client.send(0,Buffer.from([1]),{confirmed:true,maxRetries:0,budgetMs:60})
  assert.equal(unknown.status,'unknown');assert.equal(unknown.attempts,1)
  mode='normal';const sent=await client.send(0,Buffer.from([2]));assert.equal(sent.status,'sent');assert.equal(sent.receipt_bytes,0)
  const batching=new SecureV2Client({wireDeviceId,rootSecret,counter,host:'127.0.0.1',port:server.address().port,maximum:30})
  const results=await batching.sendBatch(1,[Buffer.alloc(3,1),Buffer.alloc(3,2),Buffer.alloc(3,3)],{confirmed:true,maxRetries:0,budgetMs:1000})
  assert.equal(results.length,3);assert(results.every(outcome=>outcome.frame_bytes===29&&outcome.batch_count===1&&outcome.status==='committed'))
  assert.equal(new Set(results.map(outcome=>outcome.sequence)).size,3)
  const state=path.join(dir,'counter.json'),payload=path.join(dir,'payload.bin'),output=path.join(dir,'outcome.json')
  const durable=new PersistentSequenceCounter(state,{wireDeviceId,rootSecret,trustedProvisioning:true,initialSequence:500});durable.close()
  fs.writeFileSync(payload,Buffer.from([7]))
  const env={...process.env,STRUCT_WIRE_DEVICE_ID:String(wireDeviceId),STRUCT_DEVICE_SECRET:rootSecret,STRUCT_COUNTER_FILE:state,STRUCT_HOST:'127.0.0.1',STRUCT_PORT:String(server.address().port)}
  const debug=await runCommand(process.execPath,[path.resolve(__dirname,'../../scripts/debug-send.cjs'),'--v2',payload,'--confirmed','--output',output],{env,timeout:15000})
  const outcome=JSON.parse(fs.readFileSync(output,'utf8'))
  assert.equal(outcome.sequence,500);assert.equal(outcome.status,'committed');assert.equal(outcome.frame_bytes,26);assert.equal(outcome.protocol,'Struct Secure V2')
  assert(!debug.stdout.includes(rootSecret));assert(!JSON.stringify(outcome).includes(rootSecret))
  assert.equal(outcome.receipt_bytes,21);assert.match(debug.stdout,/payload 1 B.*frame 26 B.*IPv4\/UDP 54 B.*receipt 21 B/)
  console.log('Secure V2 Node UDP SDK: exact retry, forged receipt rejection, timeout, send-once, MTU splitting and sanitized debug sender passed')
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true})}
}
run().catch(error=>{console.error(error);process.exitCode=1})
