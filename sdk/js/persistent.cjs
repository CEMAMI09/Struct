const fs=require('node:fs'), path=require('node:path')
const {randomBytes,createHash}=require('node:crypto')
const hash=s=>createHash('sha256').update(s).digest('hex')
// Single writer. Filesystem must support atomic rename and durable fsync.
class PersistentQueue {
 constructor(file,{keyId,capacity=32,recover=false}={}) {
  if(!keyId||!Number.isInteger(capacity)||capacity<1||capacity>256) throw new Error('Invalid queue settings')
  this.file=path.resolve(file);this.keyId=keyId;this.capacity=capacity;this.busy=false;this.closed=false
  fs.mkdirSync(path.dirname(this.file),{recursive:true})
  this.lock=this.file+'.lock'
  if(recover&&fs.existsSync(this.lock)) {
   const pid=Number(fs.readFileSync(this.lock,'utf8'))
   if(!Number.isInteger(pid)||pid<1) throw new Error('Invalid lock; inspect before recovery')
   try {process.kill(pid,0);throw new Error('Queue writer is still alive')} catch(e){if(e.code!=='ESRCH')throw e}
   fs.unlinkSync(this.lock)
  }
  this.fd=fs.openSync(this.lock,'wx',0o600);fs.writeFileSync(this.fd,String(process.pid));fs.fsyncSync(this.fd)
  try {
   this.records=[]
   if(fs.existsSync(this.file)) {
    if(fs.statSync(this.file).size>1024*1024)throw new Error('Queue file oversized')
    const saved=JSON.parse(fs.readFileSync(this.file,'utf8'))
    if(saved.digest!==hash(JSON.stringify(saved.data))||saved.data.version!==1||saved.data.keyId!==keyId||!Array.isArray(saved.data.records)||saved.data.records.length>capacity)throw new Error('Queue corrupt, wrong identity, or capacity reduced')
    this.records=saved.data.records
   }
  } catch(e){this.close();throw e}
 }
 check(){if(this.closed)throw new Error('Queue closed');if(this.failed)throw new Error('Storage outcome uncertain; close and reopen before further operations');if(this.busy)throw new Error('Queue busy')}
 commit(records){
  try {
  const data={version:1,keyId:this.keyId,records};const temp=this.file+'.tmp'
  const fd=fs.openSync(temp,'w',0o600)
  try{fs.writeFileSync(fd,JSON.stringify({data,digest:hash(JSON.stringify(data))}));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  fs.renameSync(temp,this.file)
  // Directory sync is supported on POSIX; Windows relies on its filesystem.
  if(process.platform!=='win32'){const dir=fs.openSync(path.dirname(this.file),'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}}
  this.records=records
  } catch(error) { this.failed=true;throw error }
 }
 enqueue(version,payload,{ttlSeconds=86400,now=Math.floor(Date.now()/1000)}={}){
  this.check()
  if(this.records.length>=this.capacity)throw new Error('Queue full; no records evicted')
  if(!Number.isInteger(version)||version<1||version>255||!Buffer.isBuffer(payload)||payload.length<1||payload.length>1286||!Number.isInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>2592000||!Number.isInteger(now)||now<1)throw new Error('Invalid queue record')
  const id=randomBytes(16).toString('hex')
  this.commit([...this.records,{id,version,payload:payload.toString('hex'),expires:now+ttlSeconds}]);return id
 }
 async flushOne(client,options={}){
  this.check();if(client.options.keyId!==this.keyId)throw new Error('Queue credential identity changed')
  if(!this.records.length)return {status:'empty'}
  const item=this.records[0]
  if(item.expires<=Math.floor(Date.now()/1000))return {status:'expired',id:item.id}
  this.busy=true
  try{
   const result=await client.send(item.version,Buffer.from(item.payload,'hex'),{...options,confirmed:true,eventId:Buffer.from(item.id,'hex')})
   if(result.status==='committed')this.commit(this.records.slice(1))
   return {...result,id:item.id}
  }finally{this.busy=false}
 }
 discard(id){this.check();if(this.records[0]?.id!==id)throw new Error('Only the reviewed head can be discarded');this.commit(this.records.slice(1))}
 close(){if(this.busy)throw new Error('Queue busy');if(!this.closed){this.closed=true;fs.closeSync(this.fd);fs.unlinkSync(this.lock)}}
}
module.exports={PersistentQueue}
