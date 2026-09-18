const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {buildCommand,verifyCommand}=require('../sdk/js/commands.cjs')
const {PersistentQueue}=require('../sdk/js/persistent.cjs')
const {deliver}=require('./outbox')
const {CommandReceiver}=require('../sdk/js/command-receiver.cjs')
async function run(){
 const secret='a'.repeat(64),keyId='0123456789abcdef'
 const frame=buildCommand({keyId,secret,commandId:Buffer.alloc(16,7),issued:1000,expires:2000,payload:Buffer.from([2])})
 assert.equal(verifyCommand(frame,{keyId,secret,now:1001}).payload[0],2)
 for(let i=0;i<frame.length;i++){const bad=Buffer.from(frame);bad[i]^=1;assert.throws(()=>verifyCommand(bad,{keyId,secret,now:1001}))}
 assert.throws(()=>verifyCommand(frame,{keyId,secret,now:2000}),/expired/)
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'struct-queue-')),file=path.join(dir,'queue.json')
 let q=new PersistentQueue(file,{keyId,capacity:1})
 try {
  const id=q.enqueue(1,Buffer.from([42]))
  assert.throws(()=>q.enqueue(1,Buffer.from([43])),/full/)
  const seen=[];const client={options:{keyId},async send(v,p,o){seen.push(o.eventId.toString('hex'));return {status:'unknown'}}}
  await q.flushOne(client);q.close();q=new PersistentQueue(file,{keyId,capacity:1})
  client.send=async(v,p,o)=>{seen.push(o.eventId.toString('hex'));return {status:'committed'}}
  await q.flushOne(client);assert.deepEqual(seen,[id,id]);assert.equal(q.records.length,0)
  q.enqueue(1,Buffer.from([42]),{now:1,ttlSeconds:1});assert.equal((await q.flushOne(client)).status,'expired')
  assert.equal(q.records.length,1)
 }finally{q.close()}
 let receiver=new CommandReceiver(path.join(dir,'commands.json'),{keyId,secret,capacity:1});let executed=0
 try {
  assert.equal(await receiver.handle(frame,async()=>{executed++;return 'executed'},async()=>{},1001),'executed')
  receiver.close();receiver=new CommandReceiver(path.join(dir,'commands.json'),{keyId,secret,capacity:1})
  assert.equal(await receiver.handle(frame,async()=>{executed++;return 'executed'},async()=>{},1001),'executed')
  assert.equal(executed,1)
  const other=buildCommand({keyId,secret,commandId:Buffer.alloc(16,8),issued:1000,expires:2000,payload:Buffer.from([2])})
  let acks=0
  await assert.rejects(receiver.handle(other,async()=>{executed++;return 'executed'},async()=>{acks++},1001),/journal full/)
  assert.equal(acks,0);assert.equal(executed,1)
  assert.equal(await receiver.handle(other,async()=>{executed++;return 'executed'},async()=>{acks++},2000),'expired')
  assert.equal(acks,1);assert.equal(executed,1)
 }finally{receiver.close();fs.rmSync(dir,{recursive:true,force:true})}
 const completions=[];const db={from(){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:{enabled:true,url:'https://example.com',signing_secret:secret}}}};return q},async rpc(n,p){completions.push(p);return {data:true}}}
 const job={id:'delivery',event_id:'stable-event',lease_token:'token',destination_url:'https://example.com',body:{id:'stable-event',type:'telemetry.received',payload:{}},routing_rule:null}
 await deliver(db,job,async(url,body,headers)=>{assert.equal(headers['x-struct-event-id'],'stable-event');return {ok:false,status:503}})
 assert.equal(completions[0].p_outcome,'retry')
 await deliver(db,job,async()=>({ok:true,status:204}));assert.equal(completions[1].p_outcome,'delivered')
 console.log('Signed commands, persistent queue reopen/identity/full/expiry, webhook retry and stable IDs passed')
}
run().catch(e=>{console.error(e);process.exitCode=1})
