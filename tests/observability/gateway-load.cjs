const {setup}=require('./fixture.cjs'),{processFrame}=require('../../tcp-server/ingest'),{performance}=require('node:perf_hooks'),fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto')
async function run(){const f=await setup(),result={timestamp:new Date().toISOString(),boundary:'Actual Node AEAD/frame processing and local SQL/PGlite. Same build with metrics off/on. No UDP socket, Supabase RTT or physical device. Loop throughput includes simulated device frame creation; per-packet latency excludes frame creation. CPU/RSS include in-process database.',stages:[]};let seq=0
 try{
  process.env.STRUCT_OBSERVABILITY_ENABLED='false';for(let i=0;i<5;i++)await f.ingest(seq++)
  for(const [name,enabled,batch] of [['metrics off',false,1],['metrics on',true,1],['metrics on, batch 10',true,10]]){
   process.env.STRUCT_OBSERVABILITY_ENABLED=String(enabled)
   const times=[],cpu=process.cpuUsage(),start=performance.now();let app=0
   for(let i=0;i<500;i++){
    const frame=f.frame(seq++,Array.from({length:batch},(_,j)=>(i+j)%256)),begin=performance.now()
    const r=await processFrame(frame,{supabase:f.adapter,transport:'udp',ipVersion:4})
    assert.equal(r.records.length,batch);assert(r.receipt)
    times.push(performance.now()-begin);app+=frame.length
   }
   const ms=performance.now()-start;times.sort((a,b)=>a-b)
   result.stages.push({name,packets:500,readings:500*batch,observedApplicationBytes:app,medianProcessingMs:times[250],p95ProcessingMs:times[475],loopDurationMs:ms,packetsPerSecond:500/ms*1000,readingsPerSecond:500*batch/ms*1000,cpuMicros:process.cpuUsage(cpu)})
  }
  let n;do{n=await f.scalar('select aggregate_metric_events(200)')}while(n)
  assert.equal(await f.scalar('select count(*)::int from telemetry'),6005)
  assert.equal(Number(await f.scalar("select sum(readings)::text from usage_rollups where grain='hour'")),5500)
  result.committedReadings=6005;result.accountedReadings=5500;result.memory=process.memoryUsage();result.migrationSHA256=createHash('sha256').update(fs.readFileSync('supabase/migrations/038_monitoring_analytics.sql')).digest('hex')
  fs.writeFileSync('docs/phase-5-8/evidence/gateway-performance.json',JSON.stringify(result,null,2)+'\n');console.log('Qualified actual frame processor metrics off/on and batching')
 }finally{await f.db.close()}
}
run().catch(e=>{console.error(e.message);process.exitCode=1})
