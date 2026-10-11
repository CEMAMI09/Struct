#!/usr/bin/env node
'use strict'
// Actual generated serializer, SDK wire functions and gateway codec. Only V2
// commits use the real disposable PostgreSQL RPC. Legacy receipts are explicitly
// codec-endpoint receipts and must not be advertised as persistence evidence.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),dgram=require('node:dgram')
const {once}=require('node:events'),{createHash,randomBytes}=require('node:crypto')
const base=path.resolve(__dirname,'..'),root=path.resolve(base,'../..')
const wire=require(path.join(root,'sdk/js/secure-v2.cjs')),packed=require(path.join(root,'protocol/schema/bitpacked.cjs'))
const legacy=require(path.join(root,'sdk/js/index.cjs')),protocol=require(path.join(root,'sdk/js/protocol.cjs'))
const {generateSchemaCode}=require(path.join(root,'web/shared/schemaCodegen.ts'))
process.env.TCP_CREDENTIAL_KEY='11'.repeat(32);process.env.STRUCT_SECURE_V2_ENABLED='true';process.env.STRUCT_SECURE_V2_MAX_FRAME_BYTES='1200'
const {encryptSecret,verifyFrameMac}=require(path.join(root,'tcp-server/auth'))
const {decryptPayload}=require(path.join(root,'tcp-server/crypto'))
const {parsePayload}=require(path.join(root,'tcp-server/parser'))
const {createDatabase}=require(path.join(root,'tests/database.cjs'))
const {processFrame}=require(path.join(root,'tcp-server/ingest')),{Trace}=require(path.join(root,'tcp-server/trace'))
const cases=JSON.parse(fs.readFileSync(path.join(base,'schemas/library.json'),'utf8'))
const output=path.join(base,'results/raw/struct.ndjson');fs.mkdirSync(path.dirname(output),{recursive:true})
if(process.argv.includes('--reset'))fs.writeFileSync(output,'')
const seen=new Set(fs.existsSync(output)?fs.readFileSync(output,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x).test_id):[])
function write(r){if(!seen.has(r.test_id)){fs.appendFileSync(output,JSON.stringify(r)+'\n');seen.add(r.test_id)}}
async function deadline(p){let t;try{return await Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('Local exchange timed out')),3000)})])}finally{clearTimeout(t)}}
const testRoot=Buffer.from(Array.from({length:32},(_,i)=>i)),secret='22'.repeat(32),encryption='44'.repeat(32)
function record(c,codec,security,confirmed,batch){
 const settings={codec,security,confirmed,batch};const id=createHash('sha256').update(JSON.stringify([c.id,settings])).digest('hex').slice(0,24)
 return {test_id:id,timestamp:new Date().toISOString(),benchmark_version:'1.0.0',protocol_category:'Struct',protocol_stack:security==='V2'?'Struct Secure V2':'Struct legacy V1'+(security==='encrypted'?' encrypted':' authenticated plaintext'),implementation:'repository JavaScript SDK + gateway',implementation_version:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),specification_version:security==='V2'?'Secure V2':'legacy protocol 2/3',schema_id:c.id,schema_definition:c.fields,sample_values:c.values,precision_policy:c.precision_policy,security_enabled:security!=='plaintext',security_configuration:security==='V2'?'ChaCha20-Poly1305 / HKDF-SHA256 / 16-byte tag':security==='encrypted'?'ChaCha20-Poly1305 + HMAC-SHA256':'HMAC-SHA256; no confidentiality',delivery_mode:confirmed?'confirmed':'unconfirmed',batch_size:batch,network_type:'IPv4',connection_mode:'connectionless',protocol_specific_settings:settings,serialized_payload_bytes:null,application_uplink_bytes:null,transport_header_bytes:null,network_header_bytes:null,total_uplink_bytes:null,application_downlink_bytes:null,total_downlink_bytes:null,handshake_bytes:0,maintenance_bytes:0,retransmission_bytes:0,total_network_bytes:null,effective_bytes_per_reading:null,decoding_verified:false,precision_error:null,measurement_type:'measured',test_status:'passed',source_references:['struct-source'],environment_metadata:{node:process.version,platform:process.platform,packet_capture:false,performance_scope:'host'},comparison_scope:security==='V2'?'actual gateway + disposable PostgreSQL commit':'actual codec/auth endpoint; legacy gateway persistence NOT tested',comparable:security==='V2'}
}
function schema(c,codec){return c.fields.map(f=>{
 if(f.optional||f.repeated)throw Error('Optional/repeated fields unsupported by current Struct schema codecs')
 if(codec==='legacy-le-v1'){
   if(['float32','int32','uint8'].includes(f.type))return f
   if(f.type==='bool')return {...f,type:'boolean'}
   if(f.type==='string'&&typeof c.values[f.name]==='string'&&/^[\x20-\x7e]*$/.test(c.values[f.name])&&c.values[f.name].length<=64)return {...f,type:'char',length:Math.max(1,c.values[f.name].length)}
   throw Error('Unsupported legacy schema field '+f.type)
 }
 if(f.type==='bool')return {...f,type:'boolean'}
 if(['float16','float32','fixed','enum'].includes(f.type))return f
 if(f.type==='bitset')return {...f,width:f.bits}
 const m=/^(u?int)(8|16|32)$/.exec(f.type)
 if(m)return {...f,type:m[1]==='uint'?'uint':'int',width:Number(m[2])}
 throw Error('Unsupported packed schema field '+f.type)
})}
function check(expected,actual,tolerance=0){const errors={};for(const [k,v]of Object.entries(expected)){
 if(typeof v==='number'){errors[k]=Math.abs(v-actual[k]);assert(errors[k]<=tolerance+1e-12,`${k}: ${v} != ${actual[k]}`)}else assert.deepEqual(actual[k],v)
}assert.equal(Object.keys(actual).length,Object.keys(expected).length);return errors}
function adapter(db){return {from(table){assert(['devices','secure_v2_credentials','secure_v2_schema_slots'].includes(table));const filters=[];const q={select(){return q},eq(k,v){assert(/^[a-z_]+$/.test(k));filters.push([k,v]);return q},async maybeSingle(){return {data:(await db.query(`select * from ${table} where ${filters.map(([k],i)=>`${k}=$${i+1}`).join(' and ')}`,filters.map(x=>x[1]))).rows[0]??null}}};return q},async rpc(name,a){assert.equal(name,'ingest_secure_v2_telemetry');try{return {data:Object.values((await db.query('select ingest_secure_v2_telemetry($1,$2,$3,$4,$5)',[a.p_wire_device_id,a.p_sequence,Buffer.from(a.p_frame_digest.slice(2),'hex'),a.p_schema_slot,JSON.stringify(a.p_records)])).rows[0])[0]}}catch(e){return {error:{message:e.message}}}}}}
async function main(){
 const db=await createDatabase(),scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
 const user='71000000-0000-0000-0000-000000000001',org='71000000-0000-0000-0000-000000000002'
 await db.query('insert into auth.users values($1,$2)',[user,'local-bench@example.invalid'])
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user])
 await db.query("insert into organizations(id,name,subscription_tier,stripe_quantity) values($1,'Local benchmark','flexible',5000)",[org])
 await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')",[org,user])
 const supabase=adapter(db),server=dgram.createSocket('udp4'),receiver=dgram.createSocket('udp4')
 server.bind(0,'127.0.0.1');receiver.bind(0,'127.0.0.1');await Promise.all([once(server,'listening'),once(receiver,'listening')])
 let active,serial=3,count=0
 server.on('message',async(frame,remote)=>{try{
   active.frames.push(Buffer.from(frame));let result
   if(active.security==='V2')result=await processFrame(frame,{transport:'udp',supabase,trace:new Trace('udp',frame.length,'local')})
   else{
     const {body,mac}=protocol.splitAuthenticatedFrame(frame);assert(verifyFrameMac(secret,body,mac))
     let payload=body.subarray(34);if(active.security==='encrypted')payload=decryptPayload(payload,encryption).subarray(4)
     result={decoded:parsePayload(payload,active.definition),receipt:active.confirmed?protocol.buildTelemetryReceipt(mac,secret):null}
   }
   active.results.push(result)
   if(result.receipt)server.send(result.receipt,remote.port,remote.address)
   active.resolve(result)
 }catch(e){active.reject(e)}})
 receiver.on('message',receipt=>{active.receipts.push(Buffer.from(receipt));active.receiptResolve(receipt)})
 try{for(const c of cases)for(const codec of ['legacy-le-v1','bitpacked-v1']){
   let definition,payload,generated
   try{
     definition=schema(c,codec)
     if(codec==='legacy-le-v1'){
       generated=generateSchemaCode(definition,1,'JavaScript');const module=await import('data:text/javascript;base64,'+Buffer.from(generated.source).toString('base64'))
       const input={...c.values};for(const f of definition)if(f.type==='char'){input[f.name]=new Uint8Array(f.length);input[f.name].set(Buffer.from(c.values[f.name],'ascii'))}
       payload=Buffer.from(module.pack(input))
     }else payload=Buffer.from(packed.encodePayload(c.values,definition))
     check(c.values,codec==='legacy-le-v1'?parsePayload(payload,definition):packed.decodePayload(payload,definition),c.precision_policy==='lossless'?0:.05)
   }catch(e){const r=record(c,codec,'V2',false,1);r.test_status='unsupported';r.measurement_type='unsupported';r.reason=e.message;write(r);continue}
   let id,device,sequence=0
   const fresh=async()=>{
     device=`71000000-0000-0000-0000-${String(serial++).padStart(12,'0')}`
     const key='bench'+String(serial).padStart(11,'0')
     await db.query('insert into devices(id,user_id,organization_id,name,api_key,key_id,api_secret_encrypted) values($1,$2,$3,$4,$5,$5,$6)',[device,user,org,c.id,key,encryptSecret(secret)])
     if(codec==='legacy-le-v1')await db.query('select publish_device_schema($1,$2,1)',[device,JSON.stringify(definition)])
     const cred=await scalar('select row_to_json(enroll_device_secure_v2($1,$2,$3,$4,$5,$6,false,0))',[device,org,encryptSecret(testRoot.toString('hex')),'1e1f',encryptSecret('33'.repeat(32)),randomBytes(32)])
     id=Number(cred.wire_device_id)
     await db.query('select publish_secure_v2_schema_slot($1,$2,$3,$4,$5,$6,$7,null)',[device,org,1,codec,JSON.stringify(definition),payload.length,codec==='legacy-le-v1'?1:null])
   }
   for(const security of codec==='legacy-le-v1'?['plaintext','encrypted','V2']:['V2'])for(const confirmed of [false,true])for(const batch of c.family==='reference'||c.family==='preset'?[1,2,5,10,25,50,100]:[1]){
     const r=record(c,codec,security,confirmed,batch);r.resolved_schema_definition=definition;if(seen.has(r.test_id))continue
     try{
       if(batch>1&&security!=='V2'){r.test_status='unsupported';r.measurement_type='unsupported';r.reason='Legacy SDK has no native batching';write(r);continue}
       if(security==='V2'&&!id)await fresh()
       const frames=security==='V2'?(batch===1?[{payload,batch:false}]:wire.splitBatch(Array(batch).fill(payload)).map(payload=>({payload,batch:true}))).map(p=>wire.buildFrame({rootSecret:testRoot,wireDeviceId:id,sequence:sequence++,slot:1,confirmed,...p})): [legacy.buildFrame({keyId:'localbenchmark01',apiSecret:secret,encryptionKey:security==='encrypted'?encryption:undefined,schemaVersion:1,payload,confirmed,timestampSec:1791676800,nonce:randomBytes(12)})]
       active={security,definition,confirmed,frames:[],receipts:[],results:[]}
       const begin=performance.now()
       for(const frame of frames){
         const processed=new Promise((resolve,reject)=>{active.resolve=resolve;active.reject=reject})
         const receiptPromise=confirmed?new Promise(resolve=>active.receiptResolve=resolve):null
         await new Promise((resolve,reject)=>receiver.send(frame,server.address().port,'127.0.0.1',e=>e?reject(e):resolve()))
         const result=await deadline(processed)
         if(confirmed){assert(result.receipt,'Gateway omitted confirmation: '+JSON.stringify(result));const receipt=await deadline(receiptPromise);assert(security==='V2'?wire.verifyReceipt(receipt,testRoot,id,frame.readUInt32BE(5)):legacy.verifyTelemetryReceipt(receipt,frame.subarray(-32),secret))}
         if(security!=='V2')check(c.values,result.decoded)
       }
       const rows=security==='V2'?(await db.query('select parsed_json as decoded from telemetry where device_id=$1 order by id',[device])).rows.slice(-batch):active.results.map(x=>({decoded:x.decoded}))
       assert.equal(rows.length,batch);let errors
       for(const row of rows)errors=check(c.values,row.decoded,c.precision_policy==='lossless'?0:.05)
       const up=active.frames.reduce((a,x)=>a+x.length,0),down=active.receipts.reduce((a,x)=>a+x.length,0)
       Object.assign(r,{serialized_payload_bytes:payload.length,application_uplink_bytes:up,application_downlink_bytes:down,transport_header_bytes:8*frames.length,network_header_bytes:20*frames.length,total_uplink_bytes:up+28*frames.length,total_downlink_bytes:down+28*active.receipts.length,total_network_bytes:up+down+28*(frames.length+active.receipts.length),effective_bytes_per_reading:(up+down+28*(frames.length+active.receipts.length))/batch,decoding_verified:true,decoded_values:rows[0].decoded,decoded_readings_count:rows.length,precision_error:errors,host_exchange_latency_ms:performance.now()-begin,datagram_count:frames.length,measurement_provenance:{application:'measured received loopback datagrams',udp_ip:'specification_calculated'},observations:{payload_hex:payload.toString('hex'),uplink_datagrams_hex:active.frames.map(x=>x.toString('hex')),downlink_datagrams_hex:active.receipts.map(x=>x.toString('hex'))},delivery_guarantee:security==='V2'?(confirmed?'actual PostgreSQL RPC commit + authenticated receipt':'actual PostgreSQL RPC commit observed locally; sender does not wait'):'codec/authentication endpoint only; no legacy database commit claim'})
       for(const frame of frames){const bad=Buffer.from(frame);bad[bad.length-1]^=1;assert(security==='V2'?assert.throws(()=>wire.decryptFrame(bad,testRoot))===undefined:!verifyFrameMac(secret,bad.subarray(0,-32),bad.subarray(-32)))}
       r.tamper_rejected=true
       if(security==='V2'&&confirmed&&batch===1){
         const before=await scalar('select count(*)::int from telemetry where device_id=$1',[device])
         const duplicate=await processFrame(frames[0],{transport:'udp',supabase,trace:new Trace('udp',frames[0].length,'local')})
         assert.equal(duplicate.duplicate,true);assert(wire.verifyReceipt(duplicate.receipt,testRoot,id,frames[0].readUInt32BE(5)))
         assert.equal(await scalar('select count(*)::int from telemetry where device_id=$1',[device]),before)
         r.replay_validation='actual gateway/RPC duplicate receipt; no duplicate database row; control check excluded from traffic measurement'
       }
     }catch(e){r.test_status='failed';r.reason=e.message}
     write(r);count++
   }
   if(device)await db.query('delete from devices where id=$1',[device])
 }
 }finally{server.close();receiver.close();await db.close()}
 console.log('Struct configurations executed:',count,'total records:',seen.size)
}
main().catch(e=>{console.error(e);process.exitCode=1})
