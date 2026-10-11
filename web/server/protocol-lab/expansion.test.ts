import { it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import * as packed from '../../../protocol/schema/bitpacked.cjs'
import * as wire from '../../../sdk/js/secure-v2.cjs'
import * as plaintext from '../../../protocol/schema/lab-plaintext.cjs'
import { defaults, makeField, presetFields, defaultRoi } from '../../shared/protocol-lab/config'
import { calculateRoi } from '../../shared/protocol-lab/roi'
import { calculate } from './engine'
import { prepare } from './encoding'
import { encodeSenml } from './lwm2m'
import type { ResearchIndex, LabMetadata } from '../../shared/protocol-lab/types'
const data = JSON.parse(gunzipSync(readFileSync(new URL('../assets/protocol-lab/index.json.gz',import.meta.url))).toString()) as ResearchIndex
const metadata = JSON.parse(readFileSync(new URL('../../public/protocol-lab/metadata.json',import.meta.url),'utf8')) as LabMetadata
it('defaults to optimized V2, retains payload when security changes and isolates the lab generation',()=>{
  const c=defaults(), secure=calculate(c,data,false).results[0]!
  expect(c.settings.precision).toBe('optimized');expect(secure.metrics.payload!.value).toBe(3)
  c.settings.security=false
  const plain=calculate(c,data,false).results[0]!
  expect(plain.payloadHex).toBe(secure.payloadHex);expect(plain.metrics.applicationUp!.value).toBe(16)
  expect(plain.metrics.security!.value).toBe(0);expect(plain.profile).toContain('LAB ONLY')
  const frame=plaintext.buildFrame({payload:Buffer.alloc(100)})
  expect(wire.isSecureV2(frame)).toBe(false);expect(()=>wire.parseHeader(frame)).toThrow()
  expect(()=>plaintext.decodeFrame(Buffer.alloc(30))).toThrow()
  c.settings.structGeneration='v1';c.settings.precision='original'
  expect(calculate(c,data,false).results[0]!.metrics.applicationUp!.value).toBe(75)
})
it('round trips binary64 precision and all wide signed/unsigned boundaries without Number coercion',()=>{
  const schema: packed.PackedField[]=[{name:'double',type:'float64'},{name:'i',type:'int',width:64},{name:'u',type:'uint',width:64}]
  const values={double:1+2**-52,i:-(1n<<63n),u:(1n<<64n)-1n}
  expect(Math.fround(values.double)).not.toBe(values.double)
  const doubles:packed.PackedField[]=[{name:'v',type:'float64'}]
  for(const v of [Number.MIN_VALUE,Number.MAX_VALUE,-0,-Math.PI,1+2**-52])expect(Object.is(packed.decodePayload(packed.encodePayload({v},doubles),doubles).v,v)).toBe(true)
  for(const v of [Infinity,-Infinity,NaN]){const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,v,false);expect(()=>packed.decodePayload(bytes,doubles)).toThrow()}
  expect(packed.decodePayload(packed.encodePayload(values,schema),schema)).toEqual(values)
  for(const width of [8,16,32,33,53,63,64])for(const signed of [true,false]){
    const min=signed?-(1n<<BigInt(width-1)):0n,max=(1n<<BigInt(signed?width-1:width))-1n
    const field: packed.PackedField={name:'v',type:signed?'int':'uint',width}
    for(const v of [min,max]){
      const input=width<=32?Number(v):v
      expect(String(packed.decodePayload(packed.encodePayload({v:input},[field]),[field]).v)).toBe(String(v))
    }
    expect(()=>packed.encodePayload({v:width<=32?Number(max+1n):max+1n},[field])).toThrow()
  }
  expect(()=>packed.decodePayload(new Uint8Array(2),schema)).toThrow()
  expect(()=>packed.encodePayload({...values,double:Infinity},schema)).toThrow()
  expect(()=>packed.encodePayload({...values,u:Number.MAX_VALUE},schema)).toThrow()
})
it('returns independent comparison dimensions and withholds different-boundary financial claims',()=>{
  const c=defaults(),response=calculate(c,data,false)
  for(const r of response.results){expect(r.reduction).not.toBeNull();expect(r.metrics.effective!.value).toBeGreaterThan(0)}
  expect(response.results.find(r=>r.id==='protobuf')!.comparison?.category).toBe('disclosed_differences')
  const roi=calculateRoi({...defaultRoi,devices:10,eventsPerDay:100,daysPerYear:365,cellularPercent:50,costPerMB:2},response.results)
  expect(roi[0]!.annualMB).toBeCloseTo(10*100*365*.5*56/1e6)
  c.settings.boundary='stream'
  expect(calculateRoi(defaultRoi,calculate(c,data,false).results).every(r=>r.annualCost===null)).toBe(true)
})
it('encodes every preset as SenML, verifies decode and optionally exports independent Leshan inputs',()=>{
  const inputs: unknown[]=[]
  for(const preset of metadata.presets)for(const precision of ['original','optimized'] as const)for(const format of ['SENML_CBOR','SENML_JSON'] as const){
    const c=defaults();c.fields=presetFields(preset);c.settings.precision=precision;c.settings.lwm2mFormat=format
    const p=prepare(c.fields,c.settings),encoded=encodeSenml(p,c.settings)
    expect(encoded.payload.length).toBeGreaterThan(0)
    inputs.push({id:preset.id+'-'+precision+'-'+format,fields:p.fields.map(f=>({...f,type:f.type==='fixed'?'uint32':f.type})),values:p.source,hex:encoded.payload.toString('hex'),format})
  }
  if(process.env.LAB_SENML_OUTPUT)writeFileSync(new URL('../../../benchmarks/multi-protocol/extensions/lab-v2/senml-input.json',import.meta.url),JSON.stringify(inputs))
  expect(inputs).toHaveLength(40)
})
it('models oversized TCP payloads with segmentation while refusing fabricated UDP fragmentation',()=>{
  const c=defaults();c.fields=[makeField('message','string','x'.repeat(4000))]
  const response=calculate(c,data,false)
  expect(response.results.find(r=>r.id==='protobuf')!.metrics.networkUp!.value).toBeGreaterThan(4000)
  expect(response.results.find(r=>r.id==='coap')!.metrics.networkUp!.value).toBeNull()
  c.settings.batch=100
  const oversized=calculate(c,data,false).results.find(r=>r.id==='lwm2m')!
  expect(oversized.metrics.effective!.value).toBeNull();expect(oversized.reason).toContain('64 KiB')
})

it('bounds UTF-8/raw byte fields, preserves embedded NUL/BOM and rejects malformed padding/text',()=>{
  const schema: packed.PackedField[]=[{name:'flag',type:'boolean'},{name:'text',type:'string',maxBytes:32},{name:'blob',type:'bytes',maxBytes:8}]
  const values={flag:true,text:'\uFEFF温度\0α',blob:Uint8Array.from([0,255,128])}
  const bytes=packed.encodePayload(values,schema)
  expect(packed.decodePayload(bytes,schema)).toEqual(values)
  expect(()=>packed.encodePayload({...values,text:'x'.repeat(33)},schema)).toThrow('maxBytes')
  expect(()=>packed.encodePayload({...values,text:'\uD800'},schema)).toThrow('UTF-8')
  const rawSchema: packed.PackedField[]=[{name:'text',type:'string',maxBytes:2}]
  expect(()=>packed.decodePayload(Uint8Array.from([0,1,255,0]),rawSchema)).toThrow()
  expect(()=>packed.decodePayload(Uint8Array.from([0,3,0,0]),rawSchema)).toThrow()
  expect(()=>packed.decodePayload(Uint8Array.from([0,0,0,1]),rawSchema)).toThrow('padding')
})

it('retrieves real CoAP/DTLS measurements without replacing them with OSCORE or custom models',()=>{
 const c=defaults();c.settings.precision='original';c.settings.coapSecurity='dtls-ccm8';c.settings.coapEncoding='protobuf'
 const r=calculate(c,data,false).results.find(r=>r.id==='coap')!
 expect(r.status).toBe('measured');expect(r.metrics.applicationUp!.value).toBe(65);expect(r.metrics.applicationDown!.value).toBe(61);expect(r.references).toHaveLength(1)
 c.settings.network='IPv6'
 const missing=calculate(c,data,false).results.find(r=>r.id==='coap')!
 expect(missing.metrics.effective!.value).toBeNull();expect(missing.reason).toContain('not measured')
})
