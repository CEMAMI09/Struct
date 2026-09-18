const {PersistentQueue}=require('./persistent.cjs')
const {verifyCommand}=require('./commands.cjs')
const {buildAckFrame}=require('./protocol.cjs')
// Persistent journal, one process/task. execute must return 'executed' or
// 'rejected'; supply device-specific idempotency using commandId when possible.
class CommandReceiver {
 constructor(file,{keyId,secret,capacity=32,recover=false}){
  this.keyId=keyId;this.secret=secret;this.store=new PersistentQueue(file,{keyId,capacity,recover});this.busy=false
 }
 async handle(frame,execute,ack=async()=>{},now=Math.floor(Date.now()/1000)){
  if(this.busy)throw new Error('Command receiver busy')
  this.store.check()
  const command=verifyCommand(frame,{keyId:this.keyId,secret:this.secret,now,allowExpired:true})
  this.busy=true
  const respond=async status=>{await ack(buildAckFrame({keyId:this.keyId,secret:this.secret,commandId:Buffer.from(command.commandId,'hex'),resultCode:{received:16,executed:17,rejected:18,expired:19,unknown:20}[status]}));return status}
  try{
   if(command.expired)return await respond('expired')
   const fingerprint=frame.subarray(-32).toString('hex')
   const previous=this.store.records.find(r=>r.id===command.commandId)
   if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Command ID content or credential conflict');return await respond(previous.status==='received'?'unknown':previous.status)}
   const retained=this.store.records.filter(r=>r.expires>now)
   // No terminal ACK without a durable record: a later replay could otherwise
   // execute a command we had already reported as rejected.
   if(retained.length>=this.store.capacity)throw new Error('Command journal full')
   const record={id:command.commandId,fingerprint,expires:command.expires,status:'received'}
   this.store.commit([...retained,record])
   await respond('received')
   let status='unknown'
   try{const result=await execute(command);if(result==='executed'||result==='rejected')status=result}catch{ /* possibly executed before throwing */ }
   try{this.store.commit([...retained,{...record,status}])}catch{return await respond('unknown')}
   return await respond(status)
  }finally{this.busy=false}
 }
 close(){if(this.busy)throw new Error('Command receiver busy');this.store.close()}
}
module.exports={CommandReceiver}
