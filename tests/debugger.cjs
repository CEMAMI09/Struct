const assert=require('node:assert/strict')
const {runScenario,scenarios}=require('../scripts/debug-local.cjs')
const {createDatabase}=require('./database.cjs')
async function run(){
 for(const scenario of scenarios){
  const b=await runScenario(scenario),fails=['malformed','authentication','schema','storage'].includes(scenario)
  assert.equal(b.stored_events,fails?0:1,scenario)
  assert.equal(b.device_outcome.status,fails||scenario==='timeout'?'unknown':'committed',scenario)
  assert.equal(b.webhook_requests,fails?0:scenario==='webhook-retry'?2:1,scenario)
  if(!fails)assert.equal(b.webhooks[0].status,'delivered',scenario)
  if(scenario==='encrypted'){const bytes=b.traces[0].bytes;assert.equal(bytes.encryption,32);assert.equal(bytes.payload+bytes.protocol+bytes.encryption,b.traces[0].frame_bytes)}
  if(scenario==='retry'||scenario==='duplicate'||scenario==='timeout')assert(b.traces.some(t=>t.replay==='duplicate committed event'),scenario)
  if(fails)assert(b.traces.some(t=>t.stages.some(s=>s.status==='failed'&&s.explanation)),scenario)
  const text=JSON.stringify(b)
  for(const field of ['api_secret','encryption_key','parsed_json','payloadHex','signature','destination_url'])assert(!text.includes(field),field)
  console.log(`Debugger real local scenario passed: ${scenario}`)
 }
 const controller=new AbortController()
 const {StructClient}=require('../sdk/js/index.cjs')
 const served=await runScenario('encrypted',{serve:true,signal:controller.signal,schema:[{name:'counter',type:'int32'}],async onReady(config){
  try{const outcome=await new StructClient(config).send(1,Buffer.from([7,0,0,0]),{confirmed:true});assert.equal(outcome.status,'committed')}finally{controller.abort()}
 }})
 assert.equal(served.stored_events,1)
 const db=await createDatabase()
 try{
  assert.equal((await db.query("select has_function_privilege('authenticated','record_packet_trace(uuid,jsonb)','EXECUTE') allowed")).rows[0].allowed,false)
  assert.equal((await db.query("select has_function_privilege('anon','enable_packet_tracing(uuid)','EXECUTE') allowed")).rows[0].allowed,false)
  await assert.rejects(db.query("select enable_packet_tracing('30000000-0000-0000-0000-000000000003')"),/Not authorized/)
  const user='40000000-0000-0000-0000-000000000001',org='40000000-0000-0000-0000-000000000002',device='40000000-0000-0000-0000-000000000003'
  await db.query('insert into auth.users values($1,$2)',[user,'trace@example.invalid'])
  await db.query("insert into organizations(id,name) values($1,'Trace test')",[org])
  await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')",[org,user])
  await db.query("insert into devices(id,user_id,organization_id,name,api_key,key_id) values($1,$2,$3,'Trace','trace-fixture','trace-fixture')",[device,user,org])
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user])
  await db.query('select enable_packet_tracing($1)',[device])
  for(let i=0;i<201;i++)await db.query('select record_packet_trace($1,$2)',[device,JSON.stringify({outcome:'processed',sequence:i})])
  await db.exec('set role authenticated')
  assert.equal((await db.query('select count(*)::int n from packet_traces')).rows[0].n,200)
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",['40000000-0000-0000-0000-000000000099'])
  assert.equal((await db.query('select count(*)::int n from packet_traces')).rows[0].n,0)
  await db.exec('reset role')
 }finally{await db.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1})
