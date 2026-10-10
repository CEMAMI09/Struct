'use strict'
const fs=require('node:fs'),path=require('node:path')
const {createHash}=require('node:crypto')
const {rootBytes,uint32,wireId}=require('./secure-v2.cjs')
const LIMIT=0x100000000
const hash=value=>createHash('sha256').update(value).digest('hex')
// One writer per credential. No silent missing-state initialization or recovery.
class PersistentSequenceCounter {
  constructor(file,{wireDeviceId,rootSecret,blockSize=1024,recover=false,trustedProvisioning=false,initialSequence=0,_bootstrap=false}={}) {
    wireId(wireDeviceId)
    if (!Number.isInteger(blockSize)||blockSize<1||blockSize>1048576) throw new Error('Invalid sequence block size')
    this.file=path.resolve(file);this.lock=this.file+'.lock';this.wireDeviceId=wireDeviceId;this.blockSize=blockSize
    this.identity=hash(Buffer.concat([Buffer.from('struct-v2/counter/identity\0'),rootBytes(rootSecret),Buffer.from(String(wireDeviceId))]))
    fs.mkdirSync(path.dirname(this.file),{recursive:true})
    if(recover&&fs.existsSync(this.lock)) {
      const pid=Number(fs.readFileSync(this.lock,'utf8'))
      if(!Number.isInteger(pid)||pid<1)throw new Error('Invalid sequence lock; manual recovery required')
      try{process.kill(pid,0);throw new Error('Sequence writer is still alive')}catch(error){if(error.code!=='ESRCH')throw error}
      fs.unlinkSync(this.lock)
    }
    this.fd=fs.openSync(this.lock,'wx',0o600);fs.writeFileSync(this.fd,String(process.pid));fs.fsyncSync(this.fd)
    try {
      if(fs.existsSync(this.file))this.load()
      else if(trustedProvisioning) {
        uint32(initialSequence,'initialSequence');this.commit(initialSequence)
      } else if(!_bootstrap) throw new Error('Sequence state missing; provision once or rotate this credential')
      this.nextValue=0;this.rangeEnd=0
    } catch(error){this.close();throw error}
  }
  load() {
    if(fs.statSync(this.file).size>2048)throw new Error('Sequence state oversized')
    const saved=JSON.parse(fs.readFileSync(this.file,'utf8')),state=saved.data
    if(!state||saved.digest!==hash(JSON.stringify(state))||state.version!==1||state.wireDeviceId!==this.wireDeviceId||state.identity!==this.identity||!Number.isInteger(state.nextUnreserved)||state.nextUnreserved<0||state.nextUnreserved>LIMIT)throw new Error('Sequence state corrupt or credential mismatch; rotate before reuse')
    this.nextUnreserved=state.nextUnreserved
  }
  commit(nextUnreserved) {
    try {
      const data={version:1,wireDeviceId:this.wireDeviceId,identity:this.identity,nextUnreserved},temp=this.file+'.tmp'
      const fd=fs.openSync(temp,'w',0o600)
      try{fs.writeFileSync(fd,JSON.stringify({data,digest:hash(JSON.stringify(data))}));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
      fs.renameSync(temp,this.file)
      if(process.platform!=='win32'){const directory=fs.openSync(path.dirname(this.file),'r');try{fs.fsyncSync(directory)}finally{fs.closeSync(directory)}}
      this.nextUnreserved=nextUnreserved
    }catch(error){this.failed=true;throw error}
  }
  next() {
    if(this.closed||this.failed)throw new Error('Sequence storage unavailable; no packets may be sent')
    if(this.nextValue===this.rangeEnd) {
      if(this.nextUnreserved===LIMIT)throw new Error('Sequence exhausted; rotate credential')
      const start=this.nextUnreserved,end=Math.min(LIMIT,start+this.blockSize)
      this.commit(end) // Durable exclusive upper bound BEFORE returning any value.
      this.nextValue=start;this.rangeEnd=end
    }
    return this.nextValue++
  }
  close(){if(!this.closed){this.closed=true;fs.closeSync(this.fd);fs.unlinkSync(this.lock)}}
  static async provision(file,{wireDeviceId,rootSecret,bootstrapToken,bootstrapOrigin='https://www.usestruct.com',blockSize=1024}={}) {
    const origin=new URL(bootstrapOrigin)
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Bootstrap origin requires authenticated HTTPS')
    if(typeof bootstrapToken!=='string'||!/^[a-f0-9]{64}$/i.test(bootstrapToken))throw new Error('One-time 256-bit bootstrap token required')
    const counter=new PersistentSequenceCounter(file,{wireDeviceId,rootSecret,blockSize,_bootstrap:true})
    try {
      if(counter.nextUnreserved!==undefined)throw new Error('Sequence state already exists; bootstrap refused')
      const response=await fetch(new URL('/api/secure-v2/bootstrap',origin),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({wireDeviceId,bootstrapToken}),signal:AbortSignal.timeout(15000),redirect:'error'})
      if(!response.ok)throw new Error('Bootstrap refused; recover state or rotate credential')
      // This endpoint grants only zero for a never-used keyspace. Bound the
      // authenticated response too; a proxy/server bug must not allocate freely
      // or guess a starting range after an uncertain provisioning outcome.
      if(!response.body)throw new Error('Invalid bootstrap grant; rotate credential')
      const reader=response.body.getReader(),chunks=[];let length=0
      try {
        for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>128)throw new Error('Invalid bootstrap grant; rotate credential');chunks.push(Buffer.from(value))}
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if(!data||Object.keys(data).length!==1||data.nextSequence!==0)throw new Error('Invalid bootstrap grant; rotate credential')
      counter.commit(0)
      return counter
    }catch(error){counter.close();throw error}
  }
}
module.exports={PersistentSequenceCounter}
