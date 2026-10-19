const assert=require('node:assert/strict'),{setup}=require('./fixture.cjs'),packed=require('../../protocol/schema/bitpacked.cjs'),wire=require('../../sdk/js/secure-v2.cjs'),{processFrame}=require('../../tcp-server/ingest')
async function run(){process.env.STRUCT_OBSERVABILITY_ENABLED='true';const f=await setup();let n=0;const check=(v,m)=>{assert(v,m);n++}
 try{
  const schema=[{name:'counter',type:'uint',width:64},{name:'negative',type:'int',width:64},{name:'precise',type:'float64'},{name:'label',type:'string',maxBytes:8},{name:'blob',type:'bytes',maxBytes:4}]
  await f.scalar('select publish_secure_v2_schema_slot($1,$2,3,$3,$4,1,null,1000)',[f.device,f.org,'bitpacked-v1',JSON.stringify(schema)])
  const bytes=Buffer.from(packed.encodePayload({counter:18446744073709551615n,negative:-9223372036854775808n,precise:Math.PI,label:'café',blob:Uint8Array.from([0,255,128])},schema)),frame=wire.buildFrame({rootSecret:f.root,wireDeviceId:f.wireId,sequence:0,slot:3,payload:bytes})
  const r=await processFrame(frame,{supabase:f.adapter,transport:'udp',ipVersion:4})
  check(r.records[0].counter.$integer==='18446744073709551615','uint64 survives authenticated gateway')
  check(r.records[0].negative.$integer==='-9223372036854775808','signed int64 survives gateway')
  check(r.records[0].precise===Math.PI&&r.records[0].precise!==Math.fround(Math.PI),'real Float64 precision')
  check(r.records[0].label==='café'&&r.records[0].blob.$bytes==='00ff80','UTF-8 and bytes preserved')
  check(Number(await f.scalar('select payload_bytes from metric_events'))===bytes.length,'actual expanded-schema payload measured')
  const rule=(await f.command('rule',{name:'Exact wide threshold',kind:'sensor',device:f.device,field:'counter',threshold:'18446744073709551614',clear:'18446744073709551613',enabled:true})).id
  await f.scalar('select evaluate_alert_rule($1)',[rule])
  check(await f.scalar('select count(*)::int from alert_incidents')===1,'wide threshold comparison exact')
  const overview=await f.scalar('select observability_overview($1,$2)',[f.org,f.user])
  check(overview.rules[0].threshold==='18446744073709551614','threshold DTO preserves exact decimal')
  check(overview.incidents[0].value==='18446744073709551615','incident value DTO preserves exact decimal')
  await f.scalar('select aggregate_metric_events(100)')
  check(Number(await f.scalar("select sum(app_bytes)::text from usage_rollups where grain='hour'"))===frame.length,'expanded schema actual application bytes')
  console.log(`PASS ${n} Float64/int64/uint64/UTF-8/binary/alert precision checks`)
 }finally{await f.db.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1})
