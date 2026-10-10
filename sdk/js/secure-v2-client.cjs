'use strict'
const dgram=require('node:dgram')
const {createHash,randomInt}=require('node:crypto')
const {performance}=require('node:perf_hooks')
const v2=require('./secure-v2.cjs')
class SecureV2Client {
  constructor({wireDeviceId,rootSecret,counter,host=v2.DEFAULT_INGEST_HOST,port=v2.DEFAULT_UDP_PORT,maximum=v2.DEFAULT_MAX_FRAME_BYTES}={}) {
    v2.wireId(wireDeviceId);v2.rootBytes(rootSecret);v2.maxFrameBytes(maximum)
    if(typeof host!=='string'||!host||!Number.isInteger(port)||port<1||port>65535||!counter||typeof counter.next!=='function'||(counter.wireDeviceId!==undefined&&counter.wireDeviceId!==wireDeviceId))throw new Error('Invalid Secure V2 client configuration')
    this.options=Object.freeze({wireDeviceId,rootSecret:Buffer.from(v2.rootBytes(rootSecret)),host,port,maximum});this.counter=counter;this.busy=false
  }
  async send(slot,payload,options={}) {
    if(!Buffer.isBuffer(payload)||payload.length<1)throw new Error('Telemetry payload must be nonempty')
    return this.sendPayload(slot,Buffer.from(payload),false,options)
  }
  async sendBatch(slot,records,options={}) {
    if(this.busy)throw new Error('A Secure V2 packet is already in flight')
    const payloads=v2.splitBatch(records,this.options.maximum),results=[]
    // Serialize every split envelope; one sequence and receipt per batch.
    for(const payload of payloads)results.push(await this.sendPayload(slot,payload,true,options))
    return results
  }
  async sendPayload(slot,payload,batch,{confirmed=false,maxRetries=1,retryMs=3000,budgetMs=7500}={}) {
    if(this.busy)throw new Error('A Secure V2 packet is already in flight')
    if(typeof confirmed!=='boolean'||!Number.isInteger(maxRetries)||maxRetries<0||maxRetries>3||!Number.isInteger(retryMs)||retryMs<1000||retryMs>30000||!Number.isInteger(budgetMs)||budgetMs<1||budgetMs>30000)throw new Error('Invalid delivery budget')
    // Validate before consuming a sequence. A failure after allocation skips it.
    v2.controlByte({slot,confirmed,batch})
    if(payload.length+v2.FRAME_OVERHEAD>this.options.maximum)throw new Error('Secure V2 frame exceeds maximum')
    this.busy=true
    try {
      const sequence=await this.counter.next(),frame=v2.buildFrame({...this.options,sequence,slot,confirmed,batch,payload})
      const details={protocol:'Struct Secure V2',cipher:'ChaCha20-Poly1305',sequence,schema_slot:slot,payload_bytes:payload.length,frame_bytes:frame.length,ipv4_udp_bytes:frame.length+28,receipt_requested:confirmed,receipt_bytes:confirmed?v2.RECEIPT_BYTES:0,batch_count:batch?payload[0]:1,packet_id:createHash('sha256').update(frame).digest('hex')}
      return await new Promise((resolve,reject)=>{
        const socket=dgram.createSocket('udp4'),start=performance.now();let done=false,attempts=0,retryTimer
        const finish=(status,error)=>{
          if(done)return;done=true;clearTimeout(budgetTimer);clearTimeout(retryTimer)
          try{socket.close()}catch{}
          if(error)reject(error);else resolve({...details,status,attempts,elapsedMs:Math.round(performance.now()-start)})
        }
        const budgetTimer=setTimeout(()=>finish('unknown'),budgetMs)
        const transmit=()=>{
          if(done)return;attempts++
          socket.send(frame,error=>{
            if(done)return
            if(error)return finish('unknown',attempts===1?error:undefined)
            if(!confirmed)return finish('sent')
            if(attempts<=maxRetries)retryTimer=setTimeout(transmit,retryMs*2**(attempts-1)+randomInt(Math.floor(retryMs/4)+1))
          })
        }
        socket.on('error',error=>finish('unknown',attempts?undefined:error))
        socket.on('message',receipt=>{if(!done&&confirmed&&v2.verifyReceipt(receipt,this.options.rootSecret,this.options.wireDeviceId,sequence))finish('committed')})
        socket.connect(this.options.port,this.options.host,transmit)
      })
    }finally{this.busy=false}
  }
}
module.exports={SecureV2Client}
