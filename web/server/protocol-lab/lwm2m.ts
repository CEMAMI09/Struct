import cbor from 'cbor'
import * as coap from 'coap-packet'
import type { LabSettings } from '../../shared/protocol-lab/types'
import { CborFloat, type Prepared } from './encoding'
// Explicit custom-object mapping, independent of Leshan's original sample object.
// All resources use /33000/0/<field index>; batching adds explicit relative times.
export function encodeSenml(p: Prepared, s: LabSettings) {
  if (p.fields.some(f => f.repeated || ['nested','null'].includes(f.type)))
    throw Error('LwM2M custom Send currently supports flat scalar resources; nested/repeated/null resource mapping requires a separate object definition.')
  if (s.lwm2mFormat === 'TLV') throw Error('TLV is not a LwM2M 1.1 Send content format. Select SenML CBOR/JSON; TLV Read measurements remain in Research Explorer.')
  const minimumBytes=Object.values(p.source).reduce<number>((sum,v)=>sum+(Buffer.isBuffer(v)?v.length:typeof v==='string'?Buffer.byteLength(v):1),0)
  if(minimumBytes*s.batch>65536)throw Error('SenML message exceeds the calculator limit of 64 KiB.')
  const rows: Map<number, unknown>[] = []
  for (let reading = 0; reading < s.batch; reading++) p.fields.forEach((f, index) => {
    if (!(f.name in p.source)) return
    const value = p.source[f.name], key = f.type === 'bool' ? 4 : f.type === 'string' ? 3 : f.type === 'bytes' ? 8 : 2
    const row = new Map<number,unknown>([[0, String(index)], [key, value]])
    if (!rows.length) row.set(-2, '/33000/0/')
    if (s.batch > 1) row.set(6, reading) // explicit example 1-second spacing
    rows.push(row)
  })
  const labels: Record<number,string> = { [-2]: 'bn', 0:'n', 2:'v', 3:'vs', 4:'vb', 6:'t', 8:'vd' }
  if (s.lwm2mFormat === 'SENML_JSON' && rows.some(row => [...row.values()].some(v => typeof v === 'bigint')))
    throw Error('SenML JSON cannot preserve integers outside JavaScript safe range in this encoder. Select SenML CBOR.')
  const isFloat = (row: Map<number,unknown>) => ['float16','float32','float64'].includes(p.fields[Number(row.get(0))]!.type)
  const encodedRows=rows.map(row=>new Map([...row].map(([k,v])=>[k,k===2 && isFloat(row)?new CborFloat(Number(v)):v])))
  const payload = s.lwm2mFormat === 'SENML_CBOR' ? cbor.encodeOne(encodedRows, {canonical:true}) : Buffer.from('['+rows.map(row=>'{'+[...row].map(([k,v])=>JSON.stringify(labels[k])+':'+(k===2 && isFloat(row) && Number.isInteger(v)?(Object.is(v,-0)?'-0.0':String(v)+'.0'):JSON.stringify(Buffer.isBuffer(v)?v.toString('base64url'):v))).join(',')+'}').join(',')+']')

  if(payload.length>65536)throw Error('SenML message exceeds the calculator limit of 64 KiB.')
  const restored = s.lwm2mFormat === 'SENML_CBOR' ? cbor.decodeFirstSync(payload) : JSON.parse(payload.toString())
  if (restored.length !== rows.length) throw Error('SenML round trip count mismatch')
  rows.forEach((row, i) => {
    for (const [k, v] of row) {
      const actual = s.lwm2mFormat === 'SENML_CBOR' ? restored[i].get(k) : restored[i][labels[k]!]
      if (Buffer.isBuffer(v) ? !(s.lwm2mFormat === 'SENML_CBOR' ? Buffer.from(actual).equals(v) : actual === v.toString('base64url')) : String(actual) !== String(v)) throw Error('SenML round trip mismatch')
    }
  })
  const content = s.lwm2mFormat === 'SENML_CBOR' ? 112 : 110
  const packet = coap.generate({ code:'POST', confirmable:s.delivery === 'confirmed', messageId:100, token:Buffer.alloc(s.coapToken,0x51),
    options:[{name:'Uri-Path',value:Buffer.from('dp')},{name:'Content-Format',value:Buffer.from([content])}],payload }, 100000)
  const response = coap.generate({code:'2.04',messageId:100, token:Buffer.alloc(s.coapToken,0x51),ack:s.delivery === 'confirmed'},100000)
  return {payload,packet,response, rows}
}
