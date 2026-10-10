import * as packed from '../../protocol/schema/bitpacked.cjs'
import type { PackedField } from '../../protocol/schema/bitpacked.cjs'
import type { SchemaField } from '../app/types'
import { generateSchemaCode, validateSchema } from './schemaCodegen'
export type { PackedField }
export type SecureV2Encoding = 'legacy-le-v1' | 'bitpacked-v1'
export interface SecureV2Slot {
  slot:number
  encoding:SecureV2Encoding
  schema_definition:PackedField[]|SchemaField[]
  record_bytes:number
  legacy_schema_version?:number|null
  sample_interval_ms?:number|null
}
export const PACKED_TYPES = ['boolean','uint','int','enum','bitset','fixed','float16','float32'] as const
export const ENVIRONMENTAL_PACKED:PackedField[] = [
  {name:'temperature',type:'fixed',min:-40,max:125,precision:0.1},
  {name:'humidity',type:'fixed',min:0,max:100,precision:0.1},
  {name:'active',type:'boolean'},
]
export function compilePacked(fields:PackedField[]) { return packed.compileSchema(fields) }
export function packedFieldDefault(name:string,type:PackedField['type']):PackedField {
  if(type==='fixed')return {name,type,min:0,max:100,precision:0.1}
  if(type==='enum')return {name,type,values:['off','on']}
  if(type==='int'||type==='uint'||type==='bitset')return {name,type,width:8}
  return {name,type}
}
export function slotRecordBytes(fields:PackedField[]|SchemaField[],encoding:SecureV2Encoding):number {
  if(encoding==='bitpacked-v1')return packed.schemaByteLength(fields as PackedField[])
  validateSchema(fields)
  const code=generateSchemaCode(fields as SchemaField[],1,'C')
  const match=code.source.match(/STRUCT_PACKET_SIZE (\d+)u/)
  if(!match)throw new Error('Legacy schema size unavailable')
  return Number(match[1])
}
export function generateV2PacketHeader(slot:SecureV2Slot):string {
  if(!Number.isInteger(slot.slot)||slot.slot<0||slot.slot>15)throw new Error('Schema slot must be 0..15')
  const size=slotRecordBytes(slot.schema_definition,slot.encoding)
  if(size!==slot.record_bytes)throw new Error('Saved slot size does not match its schema')
  if(slot.encoding==='bitpacked-v1')return packed.generateCHeader(slot.schema_definition as PackedField[],{slot:slot.slot})
  return generateSchemaCode(slot.schema_definition as SchemaField[],slot.legacy_schema_version||1,'C').source + `\n#define STRUCT_SCHEMA_SLOT ${slot.slot}u\n#define STRUCT_SCHEMA_ENCODING "legacy-le-v1"\n`
}
