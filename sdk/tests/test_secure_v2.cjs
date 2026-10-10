const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {randomBytes,createDecipheriv,createHash}=require('node:crypto')
const wire=require('../js/secure-v2.cjs'),{PersistentSequenceCounter}=require('../js/secure-v2-counter.cjs')
const fixtures=require('./secure-v2-vectors.json').vectors
for(const version of ['mbedtls','mbedtls3']){
 const folder=path.join(__dirname,'../c/src/third_party',version),provenance=JSON.parse(fs.readFileSync(path.join(folder,'provenance.json'),'utf8'))
 for(const source of provenance.files)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(folder,source.packagedPath))).digest('hex'),source.sha256,`Pinned upstream source changed: ${version}/${source.packagedPath}`)
}
for(const vector of fixtures){
 const frame=wire.buildFrame({...vector,payload:Buffer.from(vector.plaintext,'hex')})
 assert.equal(frame.toString('hex'),vector.frame,vector.name)
 const keys=wire.deriveKeys(vector.rootSecret,vector.wireDeviceId)
 for(const [name,value]of Object.entries(keys))assert.equal(value.toString('hex'),vector.keys[name],name)
 assert.equal(wire.nonce(keys.uplinkPrefix,vector.sequence).toString('hex'),vector.nonce)
 assert.equal(wire.decryptFrame(frame,vector.rootSecret).plaintext.toString('hex'),vector.plaintext)
 const receipt=wire.buildReceipt(vector.rootSecret,vector.wireDeviceId,vector.sequence)
 assert.equal(receipt.length,21);assert.equal(receipt.toString('hex'),vector.receipt)
 assert(wire.verifyReceipt(receipt,vector.rootSecret,vector.wireDeviceId,vector.sequence))
 assert(!wire.verifyReceipt(receipt,vector.rootSecret,vector.wireDeviceId,vector.sequence===0?1:0))
 for(let i=0;i<receipt.length;i++){const altered=Buffer.from(receipt);altered[i]^=1;assert(!wire.verifyReceipt(altered,vector.rootSecret,vector.wireDeviceId,vector.sequence))}
}
const vector=fixtures[0],frame=Buffer.from(vector.frame,'hex')
assert.throws(()=>wire.deriveKeys(vector.rootSecret,0),/wire device ID/)
const zeroId=Buffer.from(frame);zeroId.writeUInt32BE(0,1);assert.throws(()=>wire.parseHeader(zeroId),/wire device ID/)
assert.throws(()=>wire.buildBatch([Buffer.alloc(1200)]),/exceeds maximum/)
for(let offset=0;offset<frame.length;offset++){
 const changed=Buffer.from(frame);changed[offset]^=1
 assert.throws(()=>wire.decryptFrame(changed,vector.rootSecret),/authentication|Invalid/)
}
for(let size=0;size<frame.length;size++)assert.throws(()=>wire.decryptFrame(frame.subarray(0,size),vector.rootSecret))
assert.throws(()=>wire.decryptFrame(Buffer.concat([frame,Buffer.from([1])]),vector.rootSecret),/authentication/)
assert.throws(()=>wire.decryptFrame(frame,'ff'.repeat(32)),/authentication/)
for(const first of [0,1,2,3,4,0x40,0xc0,0xff]){const bad=Buffer.from(frame);bad[0]=first;assert.throws(()=>wire.parseHeader(bad),/Invalid/)}
const key=Buffer.from(vector.keys.uplinkKey,'hex'),wrongNonce=Buffer.from(vector.nonce,'hex');wrongNonce[0]^=1
const dec=createDecipheriv('chacha20-poly1305',key,wrongNonce,{authTagLength:16});dec.setAAD(frame.subarray(0,9));dec.setAuthTag(frame.subarray(-16));dec.update(frame.subarray(9,-16));assert.throws(()=>dec.final())
for(let i=0;i<300;i++){
 const payload=randomBytes(i%150),root=randomBytes(32),sequence=i,wireDeviceId=i+1
 const encoded=wire.buildFrame({rootSecret:root,wireDeviceId,sequence,slot:i%16,confirmed:i%2===0,batch:i%3===0,payload})
 assert(wire.decryptFrame(encoded,root).plaintext.equals(payload))
 // A hostile corpus must never read out of bounds or return unverified plaintext.
 const malformed=randomBytes(i%100);if(malformed.length)malformed[0]=0x80
 try{wire.decryptFrame(malformed,root);assert.fail('Random malformed frame authenticated')}catch(error){assert(error instanceof Error)}
}
assert.equal(wire.FRAME_OVERHEAD,25);assert.equal(frame.length,34)
assert.equal(Buffer.from(fixtures.find(v=>v.name==='packed-environmental-three').frame,'hex').length,28)
const batches=wire.splitBatch(Array.from({length:600},()=>Buffer.alloc(9)),1200)
assert.equal(batches.length,5)
for(const batch of batches){assert(batch.length+25<=1200);assert.equal(wire.splitRecords(batch,{batch:true,recordBytes:9}).length,batch[0])}
for(const payload of [Buffer.alloc(0),Buffer.from([0]),Buffer.from([2,1]),Buffer.from([1,1,2])])assert.throws(()=>wire.splitRecords(payload,{batch:true,recordBytes:1}))

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'struct-v2-counter-')),file=path.join(dir,'counter.json')
const options={wireDeviceId:123,rootSecret:'01'.repeat(32),blockSize:4}
try{
 assert.throws(()=>new PersistentSequenceCounter(file,options),/missing/)
 let counter=new PersistentSequenceCounter(file,{...options,trustedProvisioning:true})
 assert.equal(counter.next(),0);assert.equal(counter.next(),1)
 assert.throws(()=>new PersistentSequenceCounter(file,options),/EEXIST/)
 assert.throws(()=>new PersistentSequenceCounter(file,{...options,recover:true}),/still alive/)
 assert.equal(JSON.parse(fs.readFileSync(file)).data.nextUnreserved,4)
 counter.close();counter=new PersistentSequenceCounter(file,options);assert.equal(counter.next(),4);counter.close()
 assert.throws(()=>new PersistentSequenceCounter(file,{...options,rootSecret:'02'.repeat(32)}),/mismatch/)
 counter=new PersistentSequenceCounter(file,options)
 const commit=counter.commit.bind(counter);counter.commit=()=>{counter.failed=true;throw new Error('Injected persistence failure')}
 assert.throws(()=>counter.next(),/persistence failure/);assert.throws(()=>counter.next(),/unavailable/)
 counter.commit=commit;counter.close()
 counter=new PersistentSequenceCounter(file,options);assert.equal(counter.next(),8);counter.close()
 // Corruption and erase both fail closed with the existing key.
 fs.writeFileSync(file,'{}');assert.throws(()=>new PersistentSequenceCounter(file,options),/corrupt/)
 fs.unlinkSync(file);assert.throws(()=>new PersistentSequenceCounter(file,options),/missing/)
 counter=new PersistentSequenceCounter(file,{...options,trustedProvisioning:true,initialSequence:0xffffffff})
 assert.equal(counter.next(),0xffffffff);assert.throws(()=>counter.next(),/exhausted/);counter.close()
 counter=new PersistentSequenceCounter(file,options);assert.throws(()=>counter.next(),/exhausted/);counter.close()
}finally{fs.rmSync(dir,{recursive:true,force:true})}
console.log('Secure V2 vectors, tampering, hostile parser corpus, exact sizes, batching and durable counter passed')
async function provisioningTests(){
 const provisioningDir=fs.mkdtempSync(path.join(os.tmpdir(),'struct-v2-provision-')),target=path.join(provisioningDir,'state.json')
 const originalFetch=global.fetch,originalRename=fs.renameSync
 const credential={wireDeviceId:99,rootSecret:'04'.repeat(32),bootstrapToken:'05'.repeat(32)}
 let consumed=false,calls=0
 global.fetch=async(url,options)=>{
  assert.equal(String(url),'https://www.usestruct.com/api/secure-v2/bootstrap')
  assert.equal(options.redirect,'error');const body=JSON.parse(options.body)
  assert.deepEqual(Object.keys(body).sort(),['bootstrapToken','wireDeviceId']);assert.equal(body.wireDeviceId,99)
  calls++;if(consumed)return new Response('',{status:409});consumed=true;return new Response('{"nextSequence":0}')
 }
 try {
  await assert.rejects(PersistentSequenceCounter.provision(target,{...credential,bootstrapOrigin:'http://localhost'}),/HTTPS/)
  const counter=await PersistentSequenceCounter.provision(target,credential)
  assert.equal(counter.next(),0);counter.close()
  await assert.rejects(PersistentSequenceCounter.provision(target,credential),/already exists/);assert.equal(calls,1)
  fs.unlinkSync(target)
  await assert.rejects(PersistentSequenceCounter.provision(target,credential),/Bootstrap refused/)
  assert(!fs.existsSync(target),'factory erase must not silently recreate zero')
  // Power loss / uncertain write after token consumption never returns a range.
  consumed=false
  fs.renameSync=()=>{throw new Error('Injected durable commit failure')}
  await assert.rejects(PersistentSequenceCounter.provision(target,credential),/commit failure/)
  fs.renameSync=originalRename
  await assert.rejects(PersistentSequenceCounter.provision(target,credential),/Bootstrap refused/)
  assert(!fs.existsSync(target))
  for(const grant of ['{"nextSequence":1}','{"nextSequence":0,"extra":1}','x'.repeat(129),'null']){
   global.fetch=async()=>new Response(grant)
   await assert.rejects(PersistentSequenceCounter.provision(target,credential),/bootstrap grant/)
   assert(!fs.existsSync(target),'invalid grants must never create counter state')
  }
 } finally {global.fetch=originalFetch;fs.renameSync=originalRename;fs.rmSync(provisioningDir,{recursive:true,force:true})}
 console.log('Secure V2 one-time HTTPS bootstrap, factory erase, and uncertain persistence fail closed')
}
provisioningTests().catch(error=>{console.error(error);process.exitCode=1})
