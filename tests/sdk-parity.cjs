const assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),path=require('node:path')
const run=promisify(execFile),{runScenario}=require('../scripts/debug-local.cjs')
async function main(){
 for(const language of ['python','rust','legacy-node-0.1']){
  const controller=new AbortController()
  const bundle=await runScenario('encrypted',{serve:true,signal:controller.signal,async onReady(config){
   const env={...process.env,STRUCT_HOST:config.host,STRUCT_PORT:String(config.port),STRUCT_KEY_ID:config.keyId,STRUCT_API_SECRET:config.apiSecret,STRUCT_ENCRYPTION_KEY:config.encryptionKey}
   try{if(language==='python')await run(process.env.STRUCT_TEST_PYTHON||'python',['sdk/python/examples/telemetry.py'],{env,timeout:20000});
   else if(language==='rust')await run(path.resolve(process.env.STRUCT_TEST_RUST||`sdk/rust/target/debug/examples/telemetry${process.platform==='win32'?'.exe':''}`),[],{env,timeout:20000})
   else {const {StructClient}=require('../sdk/compat/v0.1.0/index.cjs');const result=await new StructClient(config).send(1,Buffer.from([42]),{confirmed:true});assert.equal(result.status,'committed')}}
   finally{controller.abort()}
  }})
  assert.equal(bundle.stored_events,1);assert.equal(bundle.webhooks[0].status,'delivered')
  assert.equal(bundle.traces[0].bytes.encryption,32)
  console.log(`${language}: real encrypted SDK → gateway → transaction → signed receipt → webhook passed`)
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
