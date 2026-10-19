'use strict'
// Process-local observed operations, never device identity or raw packet data.
const counters={packetAttempts:0,authenticatedSecureV2Packets:0,newCommittedSecureV2Packets:0,duplicateSecureV2Packets:0,processingFailures:0,decodeFailures:0,processingMs:0}
const enabled=()=>process.env.STRUCT_ENTERPRISE_ENABLED==='true'
function begin(){if(!enabled())return null;counters.packetAttempts++;return performance.now()}
function authenticated(){if(enabled())counters.authenticatedSecureV2Packets++}
function finish(start,result,stage){if(start===null)return;counters.processingMs+=Math.max(0,performance.now()-start);if(!result){counters.processingFailures++;if(stage==='decoding')counters.decodeFailures++}else if(result.eventIds){if(result.duplicate)counters.duplicateSecureV2Packets++;else counters.newCommittedSecureV2Packets++}}
function snapshot(){return{...counters}}
module.exports={begin,authenticated,finish,snapshot}
