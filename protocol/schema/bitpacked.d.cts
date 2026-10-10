export type PackedField = {name:string,type:'boolean'|'uint'|'int'|'enum'|'bitset'|'fixed'|'float16'|'float32',width?:number,min?:number,max?:number,precision?:number,clamp?:boolean,values?:string[]}
export type CompiledSchema = {fields:(PackedField & {width:number,bitOffset:number,levels?:number})[],bits:number,bytes:number,encoding:'bitpacked-v1'}
export function compileSchema(fields:unknown):CompiledSchema
export function fieldBitWidth(field:PackedField):number
export function schemaByteLength(fields:PackedField[]|CompiledSchema):number
export function encodePayload(values:Record<string,unknown>,fields:PackedField[]|CompiledSchema):Uint8Array
export function decodePayload(bytes:Uint8Array,fields:PackedField[]|CompiledSchema):Record<string,unknown>
export function generateCHeader(fields:PackedField[],options?:{slot?:number}):string
export const FIXED_EPSILON:number
export const MAX_FIELDS:number
export const MAX_BYTES:number
export function float16Code(value:number):number
export function float16Value(code:number):number
