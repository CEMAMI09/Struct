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
})
