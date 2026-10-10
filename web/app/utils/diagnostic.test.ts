import {describe,it,expect} from 'vitest'
import {sanitizeTrace,sanitizeOutcome} from './diagnostic'
describe('diagnostic privacy',()=>{
 it('strips arbitrary nested secrets and unsafe explanations',()=>{
  const trace=sanitizeTrace({mode:'local',stages:[{stage:'authentication',status:'failed',explanation:'SECRET'}],bytes:{payload:1,api_secret:'SECRET',transport_note:'SECRET'},api_secret:'SECRET'})
  expect(JSON.stringify(trace)).not.toContain('SECRET')
  expect(trace.bytes?.payload).toBe(1)
  expect(trace.stages[0].explanation).toContain('API secret')
 })
 it('rejects malformed histories and strips outcome extras',()=>{
  expect(()=>sanitizeTrace({stages:{}})).toThrow()
  expect(sanitizeOutcome({status:'committed',packet_id:'secret',credentials:'SECRET'})).toEqual({status:'committed',packet_id:undefined,attempts:undefined,elapsedMs:undefined})
 })
 it('retains bounded V2 diagnostics without keys, prefixes, tokens or arbitrary text',()=>{
  const trace=sanitizeTrace({protocol:'Struct Secure V2',cipher:'ChaCha20-Poly1305',encrypted:true,sequence:4294967295,schema_slot:15,batch_count:10,aead:'verified',duplicate:true,replay:'duplicate',receipt_requested:true,receipt_generated:true,stages:[],frame_bytes:56,bytes:{payload:30,protocol:9,encryption:16,security_overhead:25,batch_metadata:1,frame:56,ipv4_udp:84},root_secret:'SECRET',nonce_prefix:'SECRET',bootstrap_token:'SECRET'})
  expect(trace.sequence).toBe(4294967295);expect(trace.schema_slot).toBe(15);expect(trace.bytes?.security_overhead).toBe(25);expect(trace.replay).toBe('duplicate');expect(JSON.stringify(trace)).not.toContain('SECRET')
  const outcome=sanitizeOutcome({protocol:'Struct Secure V2',sequence:-1,schema_slot:16,batch_count:256,status:'committed',root_secret:'SECRET',frame_bytes:28,payload_bytes:3,receipt_bytes:21})
  expect(outcome.sequence).toBeUndefined();expect(outcome.schema_slot).toBeUndefined();expect(JSON.stringify(outcome)).not.toContain('SECRET')
 })
})
