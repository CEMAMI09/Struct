const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {once}=require('node:events'),{createHash}=require('node:crypto')
const {createDatabase}=require('../tests/database.cjs')
process.env.TCP_CREDENTIAL_KEY='11'.repeat(32);process.env.STRUCT_SECURE_V2_ENABLED='true'
const {encryptSecret}=require('./auth'),{processFrame}=require('./ingest'),{startUdpServer}=require('./udp')
const wire=require('../sdk/js/secure-v2.cjs'),{SecureV2Client,PersistentSequenceCounter}=require('../sdk/js/index.cjs')
const {Trace}=require('./trace'),packed=require('../protocol/schema/bitpacked.cjs')
async function run(){
 const db=await createDatabase(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'struct-v2-udp-'))
 const user='60000000-0000-0000-0000-000000000001',org='60000000-0000-0000-0000-000000000002',device='60000000-0000-0000-0000-000000000003'
 const secret='ab'.repeat(32),bootstrap='cd'.repeat(32),legacySecret='ef'.repeat(32),keyId='v2testlegacykey1'
 const envSchema=[{name:'temperature',type:'fixed',min:-40,max:125,precision:0.1},{name:'humidity',type:'fixed',min:0,max:100,precision:0.1},{name:'active',type:'boolean'}]
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
 let counter,udp
 try {
  await db.query('insert into auth.users values($1,$2)',[user,'secure-v2@example.invalid'])
  await db.query("insert into organizations(id,name,subscription_tier) values($1,'V2 test','pro')",[org])
  await db.query("insert into devices(id,user_id,organization_id,name,api_key,key_id,api_secret_encrypted) values($1,$2,$3,'V2 sensor',$4,$4,$5)",[device,user,org,keyId,encryptSecret(legacySecret)])
  await db.query("insert into destinations(user_id,organization_id,name,url,signing_secret) values($1,$2,'V2 receiver','https://receiver.invalid/hook','secret')",[user,org])
  const credential=await scalar('select row_to_json(enroll_device_secure_v2($1,$2,$3,$4,$5,$6,false,0))',[device,org,encryptSecret(secret),'abab',encryptSecret(bootstrap),createHash('sha256').update(bootstrap).digest()])
  const id=Number(credential.wire_device_id)
  await db.query('select publish_secure_v2_schema_slot($1,$2,0,$3,$4,1,null,null)',[device,org,'legacy-le-v1',JSON.stringify([{name:'value',type:'uint8'}])])
  await db.query('select publish_secure_v2_schema_slot($1,$2,1,$3,$4,3,null,1000)',[device,org,'bitpacked-v1',JSON.stringify(envSchema)])
  const adapter={
   from(table){
    assert(['devices','secure_v2_credentials','secure_v2_schema_slots','schema_versions'].includes(table));const filters=[]
    const query={select(){return query},eq(column,value){assert(/^[a-z_]+$/.test(column));filters.push([column,value]);return query},async maybeSingle(){
      const rows=(await db.query(`select * from ${table}${filters.length?' where '+filters.map(([column],i)=>`${column}=$${i+1}`).join(' and '):''}`,filters.map(([,value])=>value))).rows
      return {data:rows[0]??null}
    }};return query
   },
   async rpc(name,args){
    assert.equal(name,'ingest_secure_v2_telemetry')
    try{return {data:await scalar('select ingest_secure_v2_telemetry($1,$2,$3,$4,$5)',[args.p_wire_device_id,args.p_sequence,Buffer.from(args.p_frame_digest.slice(2),'hex'),args.p_schema_slot,JSON.stringify(args.p_records)])}}catch(error){return {error:{message:error.message}}}
   },
  }
  const ctx={transport:'udp',supabase:adapter}
  const frame=(sequence,value=42,options={})=>wire.buildFrame({rootSecret:secret,wireDeviceId:id,sequence,slot:0,confirmed:true,payload:Buffer.from([value]),...options})
  let rate=0
  const bad=frame(0);bad[bad.length-1]^=1
  await assert.rejects(processFrame(bad,{...ctx,authorizeRate:()=>{rate++;return {allowed:true}}}),/authentication/)
  assert.equal(rate,0);assert.equal(await scalar('select highest_sequence from secure_v2_replay_state where wire_device_id=$1',[id]),null)
  const first=await processFrame(frame(100),ctx),duplicate=await processFrame(frame(100),ctx)
  assert(first.receipt.equals(duplicate.receipt));assert.equal(duplicate.duplicate,true)
  assert.equal(await scalar('select count(*)::int from telemetry'),1);assert.equal(await scalar('select count(*)::int from webhook_deliveries'),1)
  const reordered=await processFrame(frame(99),ctx);assert.equal(reordered.trace.replay,'out_of_order')
  assert.equal((await processFrame(frame(99),ctx)).duplicate,true)
  await assert.rejects(processFrame(frame(99,43),ctx),/SEQUENCE_CONFLICT/)
  await processFrame(frame(164),ctx);await assert.rejects(processFrame(frame(100),ctx),/STALE_REPLAY/)
  const stateBefore=await scalar('select highest_sequence from secure_v2_replay_state where wire_device_id=$1',[id])
  await assert.rejects(processFrame(frame(165,42,{slot:15}),ctx),/schema slot/)
  assert.equal(await scalar('select highest_sequence from secure_v2_replay_state where wire_device_id=$1',[id]),stateBefore)
  await assert.rejects(processFrame(frame(165,42,{payload:Buffer.from([1,2])}),ctx),/payload length/)
  for(const malformed of [Buffer.alloc(0),Buffer.from([0]),Buffer.from([255,1]),Buffer.from([2,1])])await assert.rejects(processFrame(frame(165,42,{batch:true,payload:malformed}),ctx),/payload length/)
  await db.exec("create function secure_v2_test_outage() returns trigger language plpgsql as $$ begin if new.parsed_json->>'value'='13' then raise exception 'injected storage outage';end if;return new;end $$;create trigger secure_v2_test_outage before insert on telemetry for each row execute function secure_v2_test_outage();")
  const failureBatch=frame(165,42,{batch:true,payload:wire.buildBatch([Buffer.from([12]),Buffer.from([13])])})
  const eventsBefore=await scalar('select count(*)::int from telemetry'),jobsBefore=await scalar('select count(*)::int from webhook_deliveries')
  await assert.rejects(processFrame(failureBatch,ctx),/storage outage/)
  assert.equal(await scalar('select highest_sequence from secure_v2_replay_state where wire_device_id=$1',[id]),164)
  assert.equal(await scalar('select count(*)::int from telemetry'),eventsBefore);assert.equal(await scalar('select count(*)::int from webhook_deliveries'),jobsBefore)
  await db.exec('drop trigger secure_v2_test_outage on telemetry')
  const batchResult=await processFrame(failureBatch,ctx);assert.equal(batchResult.records.length,2)
  assert.equal((await processFrame(failureBatch,ctx)).duplicate,true)
  assert.equal(await scalar('select count(*)::int from telemetry'),eventsBefore+2)
  assert.equal(await scalar('select count(*)::int from webhook_deliveries'),jobsBefore+2)
  const optimized=Buffer.from(packed.encodePayload({temperature:72.4,humidity:41.8,active:true},envSchema))
  const invalidPadding=Buffer.from(optimized);invalidPadding[2]|=1
  await assert.rejects(processFrame(frame(166,42,{slot:1,payload:invalidPadding}),ctx),/padding/)
  assert.equal(await scalar('select highest_sequence from secure_v2_replay_state where wire_device_id=$1',[id]),165)
  const trace=new Trace('udp',28,'local')
  const compact=await processFrame(frame(166,42,{slot:1,payload:optimized}),{...ctx,trace})
  assert(Math.abs(compact.parsed.temperature-72.4)<1e-10);assert(Math.abs(compact.parsed.humidity-41.8)<1e-10);assert.equal(compact.parsed.active,true)
  assert.equal(compact.trace.frame_bytes,28);assert.equal(compact.trace.bytes.security_overhead,25);assert.equal(compact.trace.bytes.ipv4_udp,56);assert.equal(compact.trace.bytes.acknowledgment,21)
  // Fresh processor/store instances share durable state; worker races insert once.
  const concurrent=await Promise.all(Array.from({length:8},()=>processFrame(frame(167),{...ctx})))
  assert.equal(concurrent.filter(result=>!result.duplicate).length,1)
  assert.equal(new Set(concurrent.map(result=>result.receipt.toString('hex'))).size,1)
  const previousFlag=process.env.STRUCT_SECURE_V2_ENABLED;delete process.env.STRUCT_SECURE_V2_ENABLED
  await assert.rejects(processFrame(frame(168),ctx),/disabled/);process.env.STRUCT_SECURE_V2_ENABLED=previousFlag
  await assert.rejects(processFrame(frame(168),{...ctx,transport:'tcp'}),/requires UDP/)
  // Real UDP listener and real database transaction with SDK-managed counter.
  counter=new PersistentSequenceCounter(path.join(dir,'counter.json'),{wireDeviceId:id,rootSecret:secret,trustedProvisioning:true,initialSequence:200})
  udp=startUdpServer(adapter,{port:0});await once(udp.socket,'listening')
  const client=new SecureV2Client({wireDeviceId:id,rootSecret:secret,counter,host:'127.0.0.1',port:udp.socket.address().port})
  const delivered=await client.send(0,Buffer.from([77]),{confirmed:true,maxRetries:0,budgetMs:1000})
  assert.equal(delivered.status,'committed');assert.equal(delivered.frame_bytes,26);assert.equal(delivered.receipt_bytes,21)
  const batches=await client.sendBatch(0,[Buffer.from([78]),Buffer.from([79])],{confirmed:true,maxRetries:0,budgetMs:1000})
  assert.equal(batches[0].status,'committed');assert.equal(batches[0].batch_count,2)
  const sent=await client.send(0,Buffer.from([80]));assert.equal(sent.status,'sent');assert.equal(sent.receipt_bytes,0)
  for(let i=0;i<100&&await scalar('select highest_sequence from secure_v2_replay_state where wire_device_id=$1',[id])!==202;i++)await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(await scalar('select highest_sequence from secure_v2_replay_state where wire_device_id=$1',[id]),202)
  // Root rotation gives a distinct wire/key space and rejects prior credential.
  const rotated=await scalar('select row_to_json(enroll_device_secure_v2($1,$2,$3,$4,$5,$6,true,0))',[device,org,encryptSecret('12'.repeat(32)),'1212',encryptSecret(bootstrap),createHash('sha256').update(bootstrap).digest()])
  assert.notEqual(Number(rotated.wire_device_id),id)
  await assert.rejects(processFrame(frame(203),ctx),/authentication/)
  const newFrame=wire.buildFrame({wireDeviceId:Number(rotated.wire_device_id),rootSecret:'12'.repeat(32),sequence:0,payload:Buffer.from([1]),confirmed:true})
  assert.equal((await processFrame(newFrame,ctx)).duplicate,false)
  assert.equal(await scalar('select count(*)::int from secure_v2_packets where wire_device_id=$1',[id])<=64,true)
  console.log('Secure V2 gateway: real UDP, AEAD, packed decode, durable replay, worker races, transactional batches/outbox, receipts and rotation passed')
 }finally{if(udp)await new Promise(resolve=>udp.socket.close(resolve));counter?.close();await db.close();fs.rmSync(dir,{recursive:true,force:true})}
}
run().catch(error=>{console.error(error);process.exitCode=1})
