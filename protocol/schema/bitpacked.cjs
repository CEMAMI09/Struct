'use strict'
// Canonical bitpacked-v1 codec. No transport or cryptographic dependencies.
const FIXED_EPSILON = 1e-7 // in quantization steps, never a whole sensor unit
const MAX_FIELDS = 128
const MAX_BYTES = 1175
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
function fail(message) { throw new Error(message) }
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${name} out of range`)
  return value
}
function finite(value, name) { if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name} must be finite`); return value }
function compileSchema(definition) {
  if (!Array.isArray(definition) || !definition.length || definition.length > MAX_FIELDS) fail('Packed schema requires 1..128 fields')
  const names = new Set(); let offset = 0
  const fields = definition.map(input => {
    if (!input || typeof input.name !== 'string' || !NAME.test(input.name) || forbidden.has(input.name) || names.has(input.name)) fail('Invalid or duplicate packed field name')
    names.add(input.name)
    const f = { name: input.name, type: input.type, bitOffset: offset }; let width
    switch (input.type) {
      case 'boolean': width = 1; break
      case 'uint': case 'int': case 'bitset': {
        width = integer(input.width, 1, 32, `${f.name} width`); f.width = width
        const min = input.type === 'int' ? -(2 ** (width - 1)) : 0
        const max = input.type === 'int' ? 2 ** (width - 1) - 1 : 2 ** width - 1
        f.min = input.min === undefined ? min : integer(input.min, min, max, `${f.name} minimum`)
        f.max = input.max === undefined ? max : integer(input.max, f.min, max, `${f.name} maximum`)
        break
      }
      case 'enum': {
        if (!Array.isArray(input.values) || input.values.length < 2 || input.values.length > 256 || input.values.some(v => typeof v !== 'string' || !v.length || v.length > 64) || new Set(input.values).size !== input.values.length) fail(`${f.name} enum requires 2..256 distinct labels`)
        f.values = [...input.values]; width = Math.ceil(Math.log2(f.values.length)); break
      }
      case 'fixed': {
        f.min = finite(input.min, `${f.name} minimum`); f.max = finite(input.max, `${f.name} maximum`)
        f.precision = finite(input.precision, `${f.name} precision`)
        if (f.max <= f.min || f.precision <= 0 || typeof input.clamp !== 'undefined' && typeof input.clamp !== 'boolean') fail(`${f.name} invalid fixed range`)
        const quotient = (f.max - f.min) / f.precision
        if (!Number.isFinite(quotient) || quotient < 1 - FIXED_EPSILON || quotient > 4294967295 + FIXED_EPSILON) fail(`${f.name} fixed range exceeds 32 bits`)
        const nearest = Math.round(quotient)
        f.levels = Math.floor(Math.abs(quotient - nearest) <= FIXED_EPSILON ? nearest : quotient) + 1
        if (f.levels < 2 || f.levels > 4294967296) fail(`${f.name} invalid fixed levels`)
        width = Math.ceil(Math.log2(f.levels)); f.clamp = input.clamp === true; break
      }
      case 'float16': width = 16; break
      case 'float32': width = 32; break
      default: fail(`Unsupported packed type ${input.type}`)
    }
    f.width = width; offset += width; return f
  })
  const bytes = Math.ceil(offset / 8)
  if (bytes > MAX_BYTES) fail(`Packed payload exceeds ${MAX_BYTES} bytes`)
  return { fields, bits: offset, bytes, encoding: 'bitpacked-v1' }
}
function compiled(schema) { return Array.isArray(schema) ? compileSchema(schema) : compileSchema(schema?.fields) }
function schemaByteLength(schema) { return compiled(schema).bytes }
function fieldBitWidth(field) { return compileSchema([field]).bits }
function writeBits(bytes, offset, width, code) {
  for (let i = 0; i < width; i++) { const bit = Math.floor(code / 2 ** (width - i - 1)) % 2; if (bit) bytes[(offset + i) >>> 3] |= 1 << (7 - ((offset + i) & 7)) }
}
function readBits(bytes, offset, width) { let result = 0; for (let i = 0; i < width; i++) result = result * 2 + ((bytes[(offset + i) >>> 3] >> (7 - ((offset + i) & 7))) & 1); return result }
const floatBuffer = new ArrayBuffer(4), floatView = new DataView(floatBuffer)
function float32Code(value) { finite(value, 'float32'); floatView.setFloat32(0, value, false); const code = floatView.getUint32(0, false); if ((code & 0x7f800000) === 0x7f800000) fail('float32 out of range'); return code }
function float32Value(code) { floatView.setUint32(0, code, false); const value = floatView.getFloat32(0, false); return finite(value, 'float32') }
function roundEven(value) { const low = Math.floor(value), fraction = value - low; return fraction > 0.5 || fraction === 0.5 && low % 2 ? low + 1 : low }
function float16Code(value) {
  finite(value, 'float16'); const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0; const a = Math.abs(value)
  if (a === 0) return sign
  if (a < 2 ** -14) return sign + roundEven(a * 2 ** 24)
  let exponent = Math.floor(Math.log2(a)), mantissa = roundEven((a / 2 ** exponent - 1) * 1024)
  if (mantissa === 1024) { exponent++; mantissa = 0 }
  if (exponent > 15) fail('float16 out of range')
  return sign + (exponent + 15) * 1024 + mantissa
}
function float16Value(code) {
  const sign = code & 0x8000 ? -1 : 1, exponent = (code >> 10) & 31, mantissa = code & 1023
  if (exponent === 31) fail('float16 nonfinite code')
  return sign * (exponent ? (1 + mantissa / 1024) * 2 ** (exponent - 15) : mantissa * 2 ** -24)
}
function valueCode(value, field) {
  switch (field.type) {
    case 'boolean': if (typeof value !== 'boolean') fail(`${field.name} must be boolean`); return value ? 1 : 0
    case 'uint': case 'bitset': return integer(value, field.min, field.max, field.name)
    case 'int': integer(value, field.min, field.max, field.name); return value < 0 ? value + 2 ** field.width : value
    case 'enum': { const code = field.values.indexOf(value); if (code < 0) fail(`${field.name} invalid enum`); return code }
    case 'fixed': {
      let v = finite(value, field.name); const eps = field.precision * FIXED_EPSILON
      if (field.clamp) v = Math.max(field.min, Math.min(field.max, v))
      else if (v < field.min - eps || v > field.max + eps) fail(`${field.name} out of range`)
      v = Math.max(field.min, Math.min(field.max, v))
      const code = Math.floor((v - field.min) / field.precision + 0.5 + FIXED_EPSILON)
      return integer(code, 0, field.levels - 1, field.name)
    }
    case 'float16': return float16Code(value)
    case 'float32': return float32Code(value)
  }
}
function codeValue(code, field) {
  switch (field.type) {
    case 'boolean': return !!code
    case 'uint': case 'bitset': return integer(code, field.min, field.max, field.name)
    case 'int': return integer(code >= 2 ** (field.width - 1) ? code - 2 ** field.width : code, field.min, field.max, field.name)
    case 'enum': if (code >= field.values.length) fail(`${field.name} invalid enum code`); return field.values[code]
    case 'fixed': integer(code, 0, field.levels - 1, field.name); return field.min + code * field.precision
    case 'float16': return float16Value(code)
    case 'float32': return float32Value(code)
  }
}
function encodePayload(values, schema) {
  const s = compiled(schema)
  // Validate every value before producing any output.
  const codes = s.fields.map(f => valueCode(values?.[f.name], f)), out = new Uint8Array(s.bytes)
  s.fields.forEach((f, i) => writeBits(out, f.bitOffset, f.width, codes[i])); return out
}
function decodePayload(bytes, schema) {
  const s = compiled(schema)
  if (!(bytes instanceof Uint8Array) || bytes.length !== s.bytes) fail('Packed payload length mismatch')
  const padding = s.bytes * 8 - s.bits
  if (padding && (bytes[bytes.length - 1] & ((1 << padding) - 1))) fail('Nonzero packed padding')
  const out = {}; for (const f of s.fields) out[f.name] = codeValue(readBits(bytes, f.bitOffset, f.width), f)
  return out
}
function cNumber(n) { return Number.isInteger(n) ? `${n}.0` : String(n) }
function generateCHeader(definition, options = {}) {
  const s = compileSchema(definition), slot = options.slot === undefined ? 0 : integer(options.slot, 0, 15, 'slot')
  const members = s.fields.map(f => `  ${f.type === 'fixed' || f.type === 'float16' ? 'double' : f.type === 'float32' ? 'float' : f.type === 'int' ? 'int32_t' : f.type === 'boolean' ? 'bool' : 'uint32_t'} f_${f.name};`)
  const checks = [], encodes = []
  for (const [i, f] of s.fields.entries()) {
    const v = `p->f_${f.name}`, code = `code_${i}`
    if (f.type === 'fixed') {
      checks.push(`  double value_${i} = ${v};`, `  if (!isfinite(value_${i})) return 0;`)
      if (f.clamp) checks.push(`  if (value_${i} < ${cNumber(f.min)}) value_${i} = ${cNumber(f.min)};`, `  if (value_${i} > ${cNumber(f.max)}) value_${i} = ${cNumber(f.max)};`)
      else checks.push(`  if (value_${i} < ${cNumber(f.min)} - ${cNumber(f.precision)} * 1e-7 || value_${i} > ${cNumber(f.max)} + ${cNumber(f.precision)} * 1e-7) return 0;`, `  if (value_${i} < ${cNumber(f.min)}) value_${i} = ${cNumber(f.min)};`, `  if (value_${i} > ${cNumber(f.max)}) value_${i} = ${cNumber(f.max)};`)
      checks.push(`  double rounded_${i} = floor((value_${i} - ${cNumber(f.min)}) / ${cNumber(f.precision)} + 0.5 + 1e-7);`, `  if (rounded_${i} < 0 || rounded_${i} >= ${cNumber(f.levels)}) return 0;`, `  uint32_t ${code} = (uint32_t)rounded_${i};`)
    } else if (f.type === 'float16') checks.push(`  uint32_t ${code}; if (!struct_pack_f16(${v}, &${code})) return 0;`)
    else if (f.type === 'float32') checks.push(`  uint32_t ${code}; if (!isfinite(${v})) return 0; memcpy(&${code}, &${v}, 4);`)
    else if (f.type === 'boolean') checks.push(`  uint32_t ${code} = ${v} ? 1u : 0u;`)
    else if (f.type === 'enum') checks.push(`  if (${v} >= ${f.values.length}u) return 0;`, `  uint32_t ${code} = ${v};`)
    else {
      checks.push(`  if ((double)${v} < ${cNumber(f.min)} || (double)${v} > ${cNumber(f.max)}) return 0;`, `  uint32_t ${code} = (uint32_t)${v};`)
      if (f.type === 'int' && f.width < 32) checks.push(`  ${code} &= ${(2 ** f.width - 1)}u;`)
    }
    encodes.push(`  struct_pack_bits(out, ${f.bitOffset}u, ${f.width}u, ${code});`)
  }
  const enums = s.fields.flatMap(f => f.type === 'enum' ? f.values.map((label, i) => `#define STRUCT_ENUM_${f.name}_${i} ${i}u /* ${label.replace(/[^A-Za-z0-9 _-]/g, '_')} */`) : [])
  return [
    '#ifndef STRUCT_GENERATED_PACKED_PACKET_H', '#define STRUCT_GENERATED_PACKED_PACKET_H', '#include <stdint.h>', '#include <stddef.h>', '#include <stdbool.h>', '#include <string.h>', '#include <math.h>', '#include <float.h>',
    '#if FLT_RADIX != 2 || FLT_MANT_DIG != 24 || FLT_MAX_EXP != 128', '#error "Struct float fields require IEEE 754 binary32"', '#endif',
    `#define STRUCT_SCHEMA_SLOT ${slot}u`, '#define STRUCT_SCHEMA_ENCODING "bitpacked-v1"', `#define STRUCT_PACKET_BITS ${s.bits}u`, `#define STRUCT_PACKET_SIZE ${s.bytes}u`, ...enums,
    'typedef struct {', ...members, '} StructPacket;',
    'static inline void struct_pack_bits(uint8_t *out, size_t offset, unsigned width, uint32_t code) {',
    '  for (unsigned i=0; i<width; i++) if ((code >> (width-i-1)) & 1u) out[(offset+i)/8] |= (uint8_t)(1u << (7u-(offset+i)%8));', '}',
    'static inline double struct_pack_round_even(double value) { double low=floor(value), fraction=value-low; return fraction>0.5 || (fraction==0.5 && fmod(low,2.0)!=0) ? low+1 : low; }',
    'static inline int struct_pack_f16(double value, uint32_t *out) {',
    '  if (!isfinite(value)) return 0; uint32_t sign=signbit(value)?0x8000u:0; double a=fabs((double)value);',
    '  if (a==0) { *out=sign; return 1; }',
    '  if (a < 0x1p-14) { *out=sign+(uint32_t)struct_pack_round_even(a*0x1p24); return 1; }',
    '  int exponent; (void)frexp(a,&exponent); exponent--; double mantissa=struct_pack_round_even((a/ldexp(1.0,exponent)-1.0)*1024.0);',
    '  if (mantissa==1024) { exponent++; mantissa=0; } if (exponent>15) return 0;',
    '  *out=sign+(uint32_t)(exponent+15)*1024u+(uint32_t)mantissa; return 1;', '}',
    '/* Explicit bit writers; neither member layout nor native byte order is transmitted. */',
    'static inline size_t struct_pack_packet(uint8_t *out, size_t capacity, const StructPacket *p) {',
    '  if (!out || !p || capacity < STRUCT_PACKET_SIZE || sizeof(float)!=4) return 0;', ...checks,
    '  memset(out,0,STRUCT_PACKET_SIZE);', ...encodes, '  return STRUCT_PACKET_SIZE;', '}', '#endif', ''
  ].join('\n')
}
module.exports = { FIXED_EPSILON, MAX_FIELDS, MAX_BYTES, compileSchema, fieldBitWidth, schemaByteLength, encodePayload, decodePayload, generateCHeader, float16Code, float16Value }
