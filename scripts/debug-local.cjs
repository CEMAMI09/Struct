#!/usr/bin/env node
// Real SDK UDP + production ingestion/outbox + local PostgreSQL, no cloud keys.
const {createDatabase}=require('../tests/database.cjs')
const {randomBytes}=require('node:crypto')
const dgram=require('node:dgram'),http=require('node:http'),fs=require('node:fs'),path=require('node:path')
const scenarios=['success','encrypted','malformed','authentication','duplicate','packet-loss','timeout','retry','schema','storage','webhook-retry']
async function runScenario(scenario='success',options={}){
 if(!scenarios.includes(scenario))throw new Error(`Choose ${scenarios.join(', ')}`)
 process.env.TCP_CREDENTIAL_KEY ||= randomBytes(32).toString('hex')
 const {encryptSecret}=require('../tcp-server/auth')
 const {processFrame}=require('../tcp-server/ingest')
 const {Trace}=require('../tcp-server/trace')
 const {StructClient}=require('../sdk/js/index.cjs')
 const {tick}=require('../tcp-server/outbox')
 const db=await createDatabase(),traces=[]
 const keyId='localdebugdevice',secret=randomBytes(32).toString('hex'),enc=randomBytes(32).toString('hex')
 const user='30000000-0000-0000-0000-000000000001',org='30000000-0000-0000-0000-000000000002',id='30000000-0000-0000-0000-000000000003'
 const device={id,name:'Local fixture',organization_id:org,key_id:keyId,api_secret_encrypted:encryptSecret(secret),encryption_enabled:scenario==='encrypted',encryption_key:enc,schemas:{version:1,schema_definition:[{name:'value',type:'uint8'}]}}
 if(options.schema)device.schemas.schema_definition=options.schema
 const udp=dgram.createSocket('udp4');let requests=0,packets=0;const pending=new Set()
 const receiver=http.createServer((req,res)=>{req.resume();requests++;res.writeHead(scenario==='webhook-retry'&&requests===1?503:204);res.end()})
 try{
  require('../tcp-server/parser-native').schemaByteLength(device.schemas.schema_definition)
  await db.query('insert into auth.users values($1,$2)',[user,'debug@example.invalid'])
  await db.query("insert into organizations(id,name,subscription_tier) values($1,'Local debug','pro')",[org])
  await db.query("insert into devices(id,user_id,organization_id,name,api_key,key_id) values($1,$2,$3,'Local debug',$4,$4)",[id,user,org,keyId])
  await db.query("insert into destinations(user_id,organization_id,name,url,signing_secret) values($1,$2,'Local receiver','https://local.invalid/hook',$3)",[user,org,secret])
  if(scenario==='storage')await db.exec("create function debug_outage() returns trigger language plpgsql as $$ begin raise exception 'injected outage'; end $$;create trigger debug_outage before insert on telemetry for each row execute function debug_outage();")
  const rpcArgs={ingest_traced_telemetry:['p_device_id','p_nonce','p_frame_timestamp','p_frame_digest','p_parsed_json','p_skew_seconds','p_event_id','p_event_digest'],claim_webhook_deliveries:['p_limit'],finish_webhook_delivery:['p_id','p_token','p_outcome','p_detail']}
  const adapter={from(table){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:table==='devices'?device:table==='schema_versions'?(scenario==='schema'?null:device.schemas):table==='destinations'?{enabled:true,url:'https://local.invalid/hook',signing_secret:secret}:null}}};return q},async rpc(name,args){
   try{
    if(!rpcArgs[name])throw new Error('Unsupported local RPC')
    const values=rpcArgs[name].map(k=>typeof args[k]==='string'&&args[k].startsWith('\\x')?Buffer.from(args[k].slice(2),'hex'):args[k]??null)
    const result=await db.query(`select * from ${name}(${values.map((_,i)=>'$'+(i+1)).join(',')})`,values)
    return {data:name==='claim_webhook_deliveries'?result.rows:Object.values(result.rows[0])[0]}
   }catch(error){return {error:{message:error.message}}}
  }}
  if(scenario==='schema')device.schemas=null
  await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve))
  udp.on('message',(input,remote)=>{
   const work=(async()=>{
    packets++
    if(scenario==='packet-loss'&&packets===1){traces.push({mode:'local',fault:'Injected uplink loss before gateway receipt'});return}
    let frame=Buffer.from(input)
    if(scenario==='malformed')frame=frame.subarray(0,10)
    if(scenario==='authentication')frame[frame.length-1]^=1
    const trace=new Trace('udp',frame.length,'local');trace.data.scenario=scenario
    try{
     const result=await processFrame(frame,{supabase:adapter,transport:'udp',trace})
     if(result.receipt){
      const drop=scenario==='timeout'||(scenario==='retry'&&packets===1)
      trace.data.acknowledgment=drop?'injected receipt loss':'sent to local SDK'
      if(!drop)await new Promise((resolve,reject)=>udp.send(result.receipt,remote.port,remote.address,e=>e?reject(e):resolve()))
     }
     if(scenario==='duplicate'&&packets===1){const duplicate=new Trace('udp',frame.length,'local');await processFrame(frame,{supabase:adapter,transport:'udp',trace:duplicate});traces.push(duplicate.data)}
    }catch{/* sanitized stage explanation is already on trace */}
    traces.push(trace.data)
    if(traces.length>200)traces.splice(0,traces.length-200)
   })();pending.add(work);work.finally(()=>pending.delete(work))
  })
  await new Promise(resolve=>udp.bind(0,'127.0.0.1',resolve))
  const client=new StructClient({host:'127.0.0.1',port:udp.address().port,keyId,apiSecret:secret,...(device.encryption_enabled?{encryptionKey:enc}:{})})
  const post=async(_url,body,headers)=>fetch(`http://127.0.0.1:${receiver.address().port}/hook`,{method:'POST',headers,body})
  let outcome
  if(options.serve){
   const config={host:'127.0.0.1',port:udp.address().port,keyId,apiSecret:secret,...(device.encryption_enabled?{encryptionKey:enc}:{})}
   if(options.onReady)await options.onReady(config)
   else {
    const credentials=options.credentials||'struct-local.env'
    fs.writeFileSync(credentials,`STRUCT_HOST=${config.host}\nSTRUCT_PORT=${config.port}\nSTRUCT_KEY_ID=${keyId}\nSTRUCT_API_SECRET=${secret}\n${device.encryption_enabled?`STRUCT_ENCRYPTION_KEY=${enc}\n`:''}`,{mode:0o600,flag:'wx'})
    console.log(`Loopback gateway ready. Disposable local credentials saved to ${credentials}. Stop with Ctrl+C. Database resets when stopped.`)
   }
   let stopped=false
   const worker=(async()=>{while(!stopped){await tick(adapter,post);await new Promise(resolve=>setTimeout(resolve,200))}})()
   try{if(!options.signal?.aborted)await new Promise(resolve=>options.signal?options.signal.addEventListener('abort',resolve,{once:true}):process.once('SIGINT',resolve))}finally{stopped=true;await worker}
   outcome={status:'not observed'}
  }else outcome=await client.send(1,Buffer.from([42]),{confirmed:true,retryMs:1000,budgetMs:2400,maxRetries:1})
  await Promise.all([...pending])
  await tick(adapter,post)
  if(scenario==='webhook-retry'){await db.query("update webhook_deliveries set next_attempt_at=now() where status='pending'");await tick(adapter,post)}
  const jobs=(await db.query('select event_id,status,attempts from webhook_deliveries')).rows
  const count=(await db.query('select count(*)::int count from telemetry')).rows[0].count
  return {format:'struct-diagnostic-v1',mode:'local',scenario,created_at:new Date().toISOString(),reproduction:`node scripts/debug-local.cjs --scenario ${scenario}`,device_outcome:outcome,traces,webhooks:jobs,stored_events:count,webhook_requests:requests,privacy:'No credentials, payload values, raw frames, addresses or webhook URLs included. Local generated fixture only.',limitations:['PGlite runs migration SQL; Supabase auth/network and physical radios are not emulated.','Network faults are injected; stage execution and UDP/HTTP traffic are real.']}
 }finally{await Promise.allSettled([...pending]);try{udp.close()}catch{};await new Promise(resolve=>receiver.listening?receiver.close(resolve):resolve());await db.close()}
}
if(require.main===module){
 const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1]
 const scenario=args.includes('--scenario')?value('--scenario'):'success'
 const output=args.includes('--output')?value('--output'):'struct-diagnostic.json'
 const options={serve:args.includes('--serve'),credentials:args.includes('--credentials')?value('--credentials'):undefined}
 if(args.includes('--schema'))options.schema=JSON.parse(fs.readFileSync(value('--schema'),'utf8'))
 runScenario(scenario,options).then(bundle=>{fs.writeFileSync(path.resolve(output),JSON.stringify(bundle,null,2));console.log(`Sanitized local diagnostic saved: ${output}\nDevice: ${bundle.device_outcome.status}; stored: ${bundle.stored_events}`)}).catch(e=>{console.error(e.message);process.exitCode=1})
}
module.exports={runScenario,scenarios}
