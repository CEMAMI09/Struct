// Controlled host-only reliability/load experiment: shared queue, four tenants,
// multiple workers and actual loopback HTTP. No cloud or production capacity claim.
const assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs')
const {fixture}=require('../pipelines/fixture.cjs'),{createDatabase}=require('../database.cjs'),{startOutbox}=require('../../tcp-server/outbox'),core=require('../../tcp-server/integrations')
process.env.STRUCT_INTEGRATION_KEY='56'.repeat(32)
;(async()=>{
 const db=await createDatabase(),tenants=[],stops=[],seen=new Map(),latencies=[];let healthy=false,requests=0,temporaryFailures=0
 const receiver=http.createServer(async(req,res)=>{const parts=[];for await(const p of req)parts.push(p);const raw=Buffer.concat(parts),event=JSON.parse(raw.toString());assert.equal(req.headers['x-struct-signature'],'sha256='+crypto.createHmac('sha256','local-signing').update(raw).digest('hex'));requests++;const key=req.headers['x-struct-delivery-id'];seen.set(key,(seen.get(key)||0)+1);if(!healthy&&req.headers['x-meta-behavior']==='unavailable'){temporaryFailures++;return res.writeHead(503,{'retry-after':'1'}).end()}if(req.headers['x-meta-behavior']==='slow')await new Promise(r=>setTimeout(r,75));latencies.push(performance.now()-Number(req.headers['x-test-start']));res.writeHead(204).end()})
 await new Promise(r=>receiver.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${receiver.address().port}`
 let before,elapsed,dispatchTime
 try{
  await db.exec('update delivery_pipeline_settings set enabled=true;update integration_settings set enabled=true')
  for(let t=0;t<4;t++){
   const f=await fixture(db);tenants.push(f);await db.query('update destinations set enabled=false where id=$1',[f.destination])
   for(const behavior of ['healthy','slow','unavailable']){const id=crypto.randomUUID(),config={url:'https://app.example.com/hook',headers:{'x-meta-behavior':behavior}};await db.query('select save_integration($1,$2,$3,$4,\'http\',$5,null,$6,$7,0,false)',[f.org,f.user,id,behavior,JSON.stringify(config),JSON.stringify(core.validateMapping(null)),core.seal({signingSecret:'local-signing'},f.org,id)]);await db.query("select integration_action($1,$2,$3,1,'enable')",[f.org,f.user,id])}
  }
  const f=tenants[0],adapter={...f.adapter,from(table){if(table!=='integration_definitions')return f.adapter.from(table);const filters=[],q={select(){return q},eq(k,v){assert(['destination_id','organization_id'].includes(k));filters.push([k,v]);return q},async maybeSingle(){return {data:(await db.query(`select * from integration_definitions where ${filters.map(([k],i)=>`${k}=$${i+1}`).join(' and ')}`,filters.map(([,v])=>v))).rows[0]}}};return q},async rpc(name,args){if(name==='finish_integration_delivery'){try{const keys=Object.keys(args);return {data:await f.scalar(`select finish_integration_delivery(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')})`,Object.values(args))}}catch(e){return {error:{message:e.message}}}}if(name!=='claim_integration_deliveries')return f.adapter.rpc(name,args);try{return {data:(await db.query('select * from claim_integration_deliveries($1)',[args.p_limit])).rows}}catch(e){return {error:{message:e.message}}}}}
  const ingestStart=performance.now();for(let n=0;n<20;n++)for(const tenant of tenants)await tenant.ingest(n,[n]);elapsed=performance.now()-ingestStart
  const total=Number((await db.query('select count(*) n from webhook_deliveries where integration_snapshot is not null')).rows[0].n);assert.equal(total,240)
  before={cpu:process.cpuUsage(),memory:process.memoryUsage()};const start=performance.now()
  const postWebhook=async(_target,body,headers,signal)=>{const time=performance.now();const r=await fetch(url,{method:'POST',body,headers:{...headers,'x-test-start':String(time)},signal});return {status:r.status,ok:r.ok,retryAfter:r.headers.get('retry-after')}}
  for(let w=0;w<2;w++)stops.push(startOutbox(adapter,{pipelineV2:true,integrationsEnabled:true,concurrency:8,idlePollMs:20,integrationDependencies:{postWebhook}}))
  const deadline=Date.now()+15000
  while(temporaryFailures<4&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25))
  assert(temporaryFailures>=4,'each tenant had a temporary outage attempt');healthy=true
  // Advance only the local test scheduler, avoiding minutes of wall-clock backoff.
  await db.exec("update webhook_deliveries set next_attempt_at=now() where status='pending';update webhook_destination_runtime set next_dispatch_at=now()")
  while(Date.now()<deadline){const left=Number((await db.query("select count(*) n from webhook_deliveries where status in ('pending','sending')")).rows[0].n);if(!left)break;await new Promise(r=>setTimeout(r,25))}
  dispatchTime=performance.now()-start;await Promise.all(stops.map(s=>s()))
  assert.equal(Number((await db.query("select count(*) n from webhook_deliveries where status='delivered'")).rows[0].n),total)
  assert.equal(seen.size,total);assert.equal(Number((await db.query("select count(*) n from webhook_attempts where outcome='dispatching'")).rows[0].n),0)
  const cpu=process.cpuUsage(before.cpu),sorted=latencies.toSorted((a,b)=>a-b)
  const report={timestamp:new Date().toISOString(),passed:5,tenants:4,workers:2,concurrency_per_worker:8,events:80,delivery_jobs:total,requests,temporary_failures:temporaryFailures,unique_remote_deliveries:seen.size,ingestion_host_total_ms:elapsed,dispatch_elapsed_ms:dispatchTime,deliveries_per_second:total/dispatchTime*1000,local_request_median_ms:sorted[Math.floor(sorted.length*.5)],local_request_p95_ms:sorted[Math.floor(sorted.length*.95)],cpu_user_ms:cpu.user/1000,cpu_system_ms:cpu.system/1000,rss_before:before.memory.rss,rss_after:process.memoryUsage().rss,workers_metrics:stops.map(s=>s.metrics()),boundary:'Real local HTTP, HMAC, Secure V2 gateway and PGlite SQL; two worker loops in one process, not two PostgreSQL backends or production fleet capacity. Slow receiver=75ms, temporary HTTP503. Test scheduler advanced once for retry recovery.'}
  fs.writeFileSync('docs/phase-7/evidence/load.json',JSON.stringify(report,null,2));console.log('PASS controlled 4-tenant / 2-worker / 240-delivery outage recovery experiment')
 }finally{await Promise.all(stops.map(s=>s()));receiver.closeAllConnections();await new Promise(r=>receiver.close(r));await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
