'use strict'
// Isolated localhost UDP -> real gateway -> actual PGlite migration/RPC storage.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const {randomUUID,createHash}=require('node:crypto'),{once}=require('node:events'),dgram=require('node:dgram')
const {registerHooks}=require('node:module'),{fileURLToPath}=require('node:url'),{execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'../../../..')
const hook=registerHooks({resolve(specifier,context,next){
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!path.extname(specifier)){
  const url=new URL(specifier+'.ts',context.parentURL);if(fs.existsSync(fileURLToPath(url)))return next(url.href,context)
 }
 return next(specifier,context)
}})
const {defaults,makeField,presetFields}=require(path.join(root,'web/shared/protocol-lab/config.ts'))
const {prepare,structEncode,safeJson}=require(path.join(root,'web/server/protocol-lab/encoding.ts'))
const wire=require(path.join(root,'sdk/js/secure-v2.cjs')),packed=require(path.join(root,'protocol/schema/bitpacked.cjs'))
const plain=require(path.join(root,'protocol/schema/lab-plaintext.cjs'))
const {createDatabase}=require(path.join(root,'tests/database.cjs'))
process.env.TCP_CREDENTIAL_KEY='11'.repeat(32);process.env.STRUCT_SECURE_V2_ENABLED='true'
const {encryptSecret}=require(path.join(root,'tcp-server/auth')),{processFrame}=require(path.join(root,'tcp-server/ingest'))
const metadata=JSON.parse(fs.readFileSync(path.join(root,'web/public/protocol-lab/metadata.json')))
const core=[['flag','bool','true',1],...['int','uint'].flatMap(type=>[8,16,32,64].map(width=>[type+width,type,type==='int'?(-(1n<<BigInt(width-1))).toString():((1n<<BigInt(width))-1n).toString(),width])),
 ['double','float64','1.0000000000000002',64],['single','float32','23.5',32],['half','float16','1.5',16],['time','timestamp','18446744073709551615',64],['bits','bitset','255',8]].map(([name,type,value,width])=>({...makeField(name,type,value),width}))
core.push(makeField('label','string','温度α'),makeField('raw','bytes','00ff8053'))
core.push({...makeField('state','enum','on'),labels:['off','on','idle']},{...makeField('decimal','fixed','1.23'),min:0,max:10,step:0.01})
const schemas=[...metadata.presets.map(p=>({id:p.id,fields:presetFields(p)})),{id:'core-types',fields:core}]
async function main(){
 const started=Date.now(),db=await createDatabase(),observations=[]
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
 const user=randomUUID(),org=randomUUID(),secret='ab'.repeat(32),bootstrap='cd'.repeat(32)
 const adapter={from(table){assert(['devices','secure_v2_credentials','secure_v2_schema_slots'].includes(table));const filters=[]
  const q={select(){return q},eq(k,v){assert(/^[a-z_]+$/.test(k));filters.push([k,v]);return q},async maybeSingle(){const rows=(await db.query(`select * from ${table} where ${filters.map(([k],i)=>`${k}=$${i+1}`).join(' and ')}`,filters.map(([,v])=>v))).rows;return {data:rows[0]??null}}};return q},
  async rpc(name,args){assert.equal(name,'ingest_secure_v2_telemetry');try{return {data:await scalar('select ingest_secure_v2_telemetry($1,$2,$3,$4,$5)',[args.p_wire_device_id,args.p_sequence,Buffer.from(args.p_frame_digest.slice(2),'hex'),args.p_schema_slot,JSON.stringify(args.p_records)])}}catch(e){return {error:{message:e.message}}}}}
 const sourceFiles=['protocol/schema/bitpacked.cjs','protocol/schema/lab-plaintext.cjs','sdk/js/secure-v2.cjs','tcp-server/secure-v2.js']
 const sourceHashes=Object.fromEntries(sourceFiles.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]))
 try{
  await db.query('insert into auth.users values($1,$2)',[user,'lab-v2@example.invalid'])
  await db.query("insert into organizations(id,name,subscription_tier) values($1,'Local benchmark','scale')",[org])
  let sequence=1
  for(const schema of schemas)for(const precision of ['original','optimized']){
   const config=defaults();config.fields=schema.fields;config.settings.precision=precision
   const prepared=prepare(config.fields,config.settings),encoded=structEncode(prepared,config.settings)
   const device=randomUUID(),keyId=randomUUID().replaceAll('-','').slice(0,16)
   await db.query("insert into devices(id,user_id,organization_id,name,api_key,key_id,api_secret_encrypted) values($1,$2,$3,'Local benchmark',$4,$4,$5)",[device,user,org,keyId,encryptSecret('ef'.repeat(32))])
   const credential=await scalar('select row_to_json(enroll_device_secure_v2($1,$2,$3,$4,$5,$6,false,0))',[device,org,encryptSecret(secret),'abab',encryptSecret(bootstrap),createHash('sha256').update(bootstrap).digest()])
   const wireDeviceId=Number(credential.wire_device_id)
   await db.query('select publish_secure_v2_schema_slot($1,$2,1,$3,$4,$5,null,1000)',[device,org,encoded.encoding,JSON.stringify(encoded.definition),encoded.payload.length])
   if(schema.id==='core-types'){
    // Authenticated malformed payloads still fail decoding before storage.
    const malformedDefinition=[{name:'text',type:'string',maxBytes:2}]
    await db.query('select publish_secure_v2_schema_slot($1,$2,2,$3,$4,$5,null,1000)',[device,org,'bitpacked-v1',JSON.stringify(malformedDefinition),4])
    const before=await scalar('select count(*)::int from telemetry')
    for(const badPayload of [[0,1,255,0],[0,3,0,0],[0,0,0,1]]){
     const frame=wire.buildFrame({payload:Buffer.from(badPayload),wireDeviceId,rootSecret:secret,sequence:sequence++,slot:2,confirmed:true})
     await assert.rejects(processFrame(frame,{transport:'udp',supabase:adapter}))
    }
    assert.equal(await scalar('select count(*)::int from telemetry'),before)
    const zig=process.env.STRUCT_ZIG_COMPILER
    if(!zig)throw Error('Set STRUCT_ZIG_COMPILER for mandatory generated C parity')
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'struct-core-types-'))
    try{
     fs.writeFileSync(path.join(dir,'packet.h'),encoded.sample)
     const assignments=core.map(f=>['string','bytes'].includes(f.type)?`memcpy(p.f_${f.name}.data,(const uint8_t[]){${[...Buffer.from(f.value,f.type==='bytes'?'hex':'utf8')].join(',')}},${Buffer.byteLength(f.value,f.type==='bytes'?'hex':'utf8')});p.f_${f.name}.length=${Buffer.byteLength(f.value,f.type==='bytes'?'hex':'utf8')};`:`p.f_${f.name}=${f.type==='enum'?1:f.type==='bool'?'true':f.type==='int'&&f.width===64?'INT64_MIN':['uint','timestamp'].includes(f.type)&&f.width===64?'UINT64_MAX':f.value};`).join('\n')
     fs.writeFileSync(path.join(dir,'test.c'),`#include <stdio.h>\n#include <assert.h>\n#include "packet.h"\nint main(){StructPacket p={0};${assignments} uint8_t out[STRUCT_PACKET_SIZE];assert(!struct_pack_packet(out,sizeof(out)-1,&p));p.f_double=INFINITY;assert(!struct_pack_packet(out,sizeof(out),&p));p.f_double=1.0000000000000002;p.f_label.length=65;assert(!struct_pack_packet(out,sizeof(out),&p));p.f_label.length=1;p.f_label.data[0]=255;assert(!struct_pack_packet(out,sizeof(out),&p));memcpy(p.f_label.data,(const uint8_t[]){230,184,169,229,186,166,206,177},8);p.f_label.length=8;if(!struct_pack_packet(out,sizeof(out),&p))return 1;for(int i=0;i<sizeof(out);i++)printf("%02x",out[i]);return 0;}`)
     const wasm=path.join(dir,'test.wasm');execFileSync(zig,['cc','-target','wasm32-wasi','-O2',path.join(dir,'test.c'),'-lm','-o',wasm])
     const output=execFileSync(process.execPath,['-e',`const {WASI}=require('node:wasi'),fs=require('node:fs');const w=new WASI({version:'preview1',returnOnExit:true});process.exitCode=w.start(new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(process.argv[1])),w.getImportObject()));`,wasm],{encoding:'utf8'})
     assert.equal(output,encoded.payload.toString('hex'))
     fs.writeFileSync(path.join(__dirname,`generated-core-${precision}.h`),encoded.sample)
    }finally{fs.rmSync(dir,{recursive:true,force:true})}
   }
   for(const network of ['IPv4','IPv6'])for(const security of [true,false])for(const confirmed of [false,true])for(const batch of [1,10]){
    const family=network==='IPv4'?'udp4':'udp6',host=network==='IPv4'?'127.0.0.1':'::1'
    const server=dgram.createSocket(family),client=dgram.createSocket(family)
    server.bind(0,host);await once(server,'listening');client.bind(0,host);await once(client,'listening')
    const responses=[],received=[],decoded=[];let failure
    server.on('message',async(frame,remote)=>{try{
     received.push(frame)
     if(security){const result=await processFrame(frame,{transport:'udp',supabase:adapter});decoded.push(...result.records);if(result.receipt){responses.push(result.receipt);server.send(result.receipt,remote.port,remote.address)}}
     else{const parsed=plain.decodeFrame(frame);const records=wire.splitRecords(parsed.plaintext,{batch:parsed.batch,recordBytes:encoded.payload.length});decoded.push(...records.map(p=>encoded.encoding==='bitpacked-v1'?safeJson(packed.decodePayload(p,encoded.definition)):require(path.join(root,'tcp-server/parser')).parsePayload(p,encoded.definition)));if(parsed.confirmed){const receipt=plain.receipt(parsed.sequence);responses.push(receipt);server.send(receipt,remote.port,remote.address)}}
    }catch(e){failure=e}})
    try{
     const payloads=batch===1?[encoded.payload]:wire.splitBatch(Array.from({length:batch},()=>encoded.payload))
     for(const payload of payloads){const options={payload,wireDeviceId,rootSecret:secret,sequence:sequence++,slot:1,confirmed,batch:batch>1};const frame=security?wire.buildFrame(options):plain.buildFrame(options)
      if(!security){assert.equal(wire.isSecureV2(frame),false);assert.throws(()=>wire.parseHeader(frame));await assert.rejects(processFrame(frame,{transport:'udp',supabase:adapter}))}
      else{const bad=Buffer.from(frame);bad[bad.length-1]^=1;await assert.rejects(processFrame(bad,{transport:'udp',supabase:adapter}),/authentication/)}
      const response=confirmed?once(client,'message'):null
      client.send(frame,server.address().port,host)
      if(response){const [receipt]=await Promise.race([response,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Receipt timeout')),5000);timer.unref()})]);assert(security?wire.verifyReceipt(receipt,secret,wireDeviceId,options.sequence):receipt.equals(plain.receipt(options.sequence)))}
     }
     const deadline=Date.now()+5000;while(decoded.length<batch&&!failure&&Date.now()<deadline)await new Promise(r=>setTimeout(r,1))
     if(failure)throw failure;assert.equal(decoded.length,batch)
     for(const reading of decoded){const expected=safeJson(prepared.decoded);for(const [name,value] of Object.entries(expected)){if(typeof value==='number' && schema.fields.find(f=>f.name===name)?.type==='float64')assert(Object.is(reading[name],value),'Float64 lost binary64 precision');else if(typeof value==='number')assert(Math.abs(reading[name]-value)<=Math.max(1,Math.abs(value))*1e-12);else assert.deepEqual(reading[name],value)}}
     const up=received.reduce((n,b)=>n+b.length,0),down=responses.reduce((n,b)=>n+b.length,0),ip=network==='IPv4'?20:40
     observations.push({test_id:createHash('sha256').update(JSON.stringify({schema:schema.id,precision,network,security,confirmed,batch})).digest('hex').slice(0,24),benchmark_version:'2.0.0-lab-coverage',timestamp:new Date().toISOString(),schema_id:schema.id,schema_definition:encoded.definition,requested_values:Object.fromEntries(schema.fields.map(f=>[f.name,f.value])),sample_values:safeJson(prepared.values),numerical_errors:Object.fromEntries(schema.fields.filter(f=>['float16','float32','float64','fixed'].includes(f.type)).map(f=>[f.name,{requested:Number(f.value),decoded:decoded[0][f.name],absolute_error:Math.abs(decoded[0][f.name]-Number(f.value)),declared_step:f.step??null}])),decoded_values:safeJson(decoded[0]),precision_errors:prepared.warnings,encoding:encoded.encoding,precision,network,security,delivery:confirmed?'confirmed':'unconfirmed',batch_size:batch,connection_mode:'preprovisioned steady state',serialized_payload_bytes:encoded.payload.length*batch,payload_hex:encoded.payload.toString('hex'),application_uplink_bytes:up,application_downlink_bytes:down,protocol_framing_bytes:up-encoded.payload.length*batch-(security?16*received.length:0),security_overhead_bytes:security?16*received.length:0,total_uplink_bytes:up+received.length*(ip+8),total_downlink_bytes:down+responses.length*(ip+8),effective_bytes_per_reading:(up+down+(received.length+responses.length)*(ip+8))/batch,observations:{up:received.map(b=>b.toString('hex')),down:responses.map(b=>b.toString('hex'))},measurement_type:'measured',measurement_provenance:{application:'actual loopback UDP and production gateway/PGlite for secure mode',network:'specification-calculated UDP/IP; no packet capture'},decoding_verified:true,tamper_rejected:security,production_parser_rejected:!security,source_hashes:sourceHashes,environment:{node:process.version,os:os.platform(),arch:os.arch(),git:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()},source_references:['struct-source'],test_status:'passed'})
    }finally{server.close();client.close()}
   }
  }
  const telemetry=await scalar('select count(*)::int from telemetry')
  const {gzipSync}=require('node:zlib');fs.writeFileSync(path.join(__dirname,'struct-observations.ndjson.gz'),gzipSync(observations.map(x=>JSON.stringify(x)).join('\n')+'\n'))
  console.log(JSON.stringify({passed:observations.length,persisted_readings:telemetry,runtime_seconds:(Date.now()-started)/1000,generated_C_parity:true,authenticated_malformed_payloads_rejected:6,generated_C_invalid_inputs_rejected:true}))
 }finally{await db.close();hook.deregister()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
