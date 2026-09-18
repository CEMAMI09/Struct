import type { SchemaField } from '../app/types'

export const CODE_LANGUAGES = ['C', 'C++', 'JavaScript', 'Python', 'Rust', 'Arduino'] as const
export type CodeLanguage = typeof CODE_LANGUAGES[number]

export function validateSchema(fields: unknown, encrypted = false): asserts fields is SchemaField[] {
  if (!Array.isArray(fields) || !fields.length) throw new Error('Add at least one field.')
  const names = new Set<string>()
  let size = 0
  for (const f of fields) {
    if (!f || typeof f.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name) ||
        ['__proto__', 'prototype', 'constructor'].includes(f.name)) throw new Error('Use valid, non-reserved field names.')
    if (names.has(f.name)) throw new Error(`Duplicate field name "${f.name}".`)
    names.add(f.name)
    if (!['float32', 'int32', 'uint8', 'boolean', 'flags', 'char'].includes(f.type)) throw new Error(`Unsupported type "${f.type}".`)
    if (f.type === 'char' && (!Number.isInteger(f.length) || f.length < 1 || f.length > 64)) throw new Error('char length must be 1..64.')
    if (f.type === 'flags') {
      if (!Array.isArray(f.bits) || !f.bits.length || f.bits.length > 8) throw new Error('Flags need 1..8 named bits.')
      const bits = new Set<number>(), labels = new Set<string>()
      for (const b of f.bits) {
        if (!b || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(b.name) || ['__proto__', 'prototype', 'constructor'].includes(b.name) ||
            !Number.isInteger(b.bit) || b.bit < 0 || b.bit > 7 || bits.has(b.bit) || labels.has(b.name)) {
          throw new Error(`Invalid or duplicate bit in "${f.name}".`)
        }
        bits.add(b.bit); labels.add(b.name)
      }
    }
    size += fieldSize(f)
  }
  if (size + 66 + (encrypted ? 32 : 0) > 1400) throw new Error('Schema exceeds the 1400-byte frame limit.')
}

const fieldSize = (f: SchemaField) => f.type === 'char' ? f.length : ['float32', 'int32'].includes(f.type) ? 4 : 1

/** Encoders deliberately avoid native struct layout, host byte order, and
 * language keywords. C/Rust member names have f_ prefixes; JSON names stay intact. */
export function generateSchemaCode(fields: SchemaField[], version: number, language: CodeLanguage, encrypted = false) {
  validateSchema(fields, encrypted)
  if (!Number.isInteger(version) || version < 1 || version > 255) throw new Error('Publish a schema version in 1..255.')
  const size = fields.reduce((n, f) => n + fieldSize(f), 0)
  const ext = ({ C: 'h', 'C++': 'h', Arduino: 'h', JavaScript: 'mjs', Python: 'py', Rust: 'rs' } as const)[language]
  let source = ''
  if (language === 'C' || language === 'C++' || language === 'Arduino') {
    const members = fields.map(f => `  ${f.type === 'float32' ? 'float' : f.type === 'int32' ? 'int32_t' : 'uint8_t'} f_${f.name}${f.type === 'char' ? `[${f.length}]` : ''};`)
    let offset = 0
    const encode = fields.map(f => {
      const target = `out + ${offset}`, value = `p->f_${f.name}`
      offset += fieldSize(f)
      return f.type === 'float32' ? `  struct_put_f32(${target}, ${value});` :
        f.type === 'int32' ? `  struct_put_u32(${target}, (uint32_t)${value});` :
        f.type === 'char' ? `  memcpy(${target}, ${value}, ${f.length});` :
        `  out[${offset - 1}] = ${f.type === 'boolean' ? `!!${value}` : value};`
    })
    const masks = fields.flatMap(f => f.type === 'flags' ? f.bits.map(b => `#define STRUCT_FLAG_${f.name}_${b.name} (1u << ${b.bit})`) : [])
    source = [`#ifndef STRUCT_PACKET_V${version}_H`, `#define STRUCT_PACKET_V${version}_H`,
      '#include <string.h>', '#include "struct_sdk.h"', '',
      `#define STRUCT_SCHEMA_VERSION ${version}`, `#define STRUCT_PACKET_SIZE ${size}u`, ...masks,
      '// Native member layout is irrelevant: always call struct_pack_packet.',
      'typedef struct {', ...members, '} StructPacket;', '',
      'static inline size_t struct_pack_packet(uint8_t *out, size_t capacity, const StructPacket *p) {',
      '  if (!out || !p || capacity < STRUCT_PACKET_SIZE) return 0;', ...encode,
      '  return STRUCT_PACKET_SIZE;', '}', '#endif', ''].join('\n')
  } else if (language === 'JavaScript') {
    let offset = 0
    const lines = fields.flatMap(f => {
      const pos = offset, v = `values[${JSON.stringify(f.name)}]`; offset += fieldSize(f)
      if (f.type === 'char') return [
        `  if (!(${v} instanceof Uint8Array) || ${v}.length !== ${f.length}) throw new Error('${f.name} needs ${f.length} raw bytes');`,
        `  out.set(${v}, ${pos});`]
      if (f.type === 'flags') return [`  view.setUint8(${pos}, ${f.bits.map(b => `(${v}?.[${JSON.stringify(b.name)}] ? ${1 << b.bit} : 0)`).join(' | ')});`]
      if (f.type === 'boolean') return [`  if (typeof ${v} !== 'boolean') throw new Error('${f.name} must be boolean');`, `  view.setUint8(${pos}, ${v} ? 1 : 0);`]
      const check = f.type === 'float32' ? `!Number.isFinite(${v}) || Math.abs(${v}) > 3.4028234663852886e38` : `!Number.isInteger(${v}) || ${v} < ${f.type === 'int32' ? '-2147483648' : '0'} || ${v} > ${f.type === 'int32' ? '2147483647' : '255'}`
      return [`  if (${check}) throw new Error('${f.name} out of range');`,
        `  view.${f.type === 'float32' ? 'setFloat32' : f.type === 'int32' ? 'setInt32' : 'setUint8'}(${pos}, ${v}${f.type === 'uint8' ? '' : ', true'});`]
    })
    source = [`// Use Buffer.from(pack(values)) with the Node StructClient.`,
      `export const SCHEMA_VERSION = ${version};`, `export const PACKET_SIZE = ${size};`,
      'export function pack(values) {', '  const out = new Uint8Array(PACKET_SIZE);',
      '  const view = new DataView(out.buffer);', ...lines, '  return out;', '}', ''].join('\n')
  } else if (language === 'Python') {
    const format = '<' + fields.map(f => f.type === 'char' ? `${f.length}s` : f.type === 'float32' ? 'f' : f.type === 'int32' ? 'i' : 'B').join('')
    const checks = fields.flatMap(f => {
      const v = `values[${JSON.stringify(f.name)}]`
      if (f.type === 'char') return [`    if not isinstance(${v}, bytes) or len(${v}) != ${f.length}:`, `        raise ValueError('${f.name} needs ${f.length} raw bytes')`]
      if (f.type === 'boolean') return [`    if type(${v}) is not bool:`, `        raise ValueError('${f.name} must be boolean')`]
      return []
    })
    const args = fields.map(f => {
      const v = `values[${JSON.stringify(f.name)}]`
      return f.type === 'flags' ? '(' + f.bits.map(b => `(${1 << b.bit} if ${v}.get(${JSON.stringify(b.name)}, False) else 0)`).join(' | ') + ')' : v
    })
    source = ['import struct', `SCHEMA_VERSION = ${version}`, `PACKET_SIZE = ${size}`, '',
      'def pack(values):', ...checks, `    return struct.pack('${format}', ${args.join(', ')})`, ''].join('\n')
  } else {
    let offset = 0
    const lines = fields.map(f => {
      const start = offset, v = `self.f_${f.name}`; offset += fieldSize(f)
      return f.type === 'char' ? `        out[${start}..${offset}].copy_from_slice(&${v});` :
        ['int32', 'float32'].includes(f.type) ? `        out[${start}..${offset}].copy_from_slice(&${v}.to_le_bytes());` :
        `        out[${start}] = ${v}${f.type === 'boolean' ? ' as u8' : ''};`
    })
    source = ['// Dependency-free payload encoder. Supply pack() bytes to a device transport.',
      `pub const SCHEMA_VERSION: u8 = ${version};`, `pub const PACKET_SIZE: usize = ${size};`,
      'pub struct StructPacket {', ...fields.map(f => `    pub f_${f.name}: ${f.type === 'float32' ? 'f32' : f.type === 'int32' ? 'i32' : f.type === 'boolean' ? 'bool' : f.type === 'char' ? `[u8; ${f.length}]` : 'u8'},`),
      '}', 'impl StructPacket {', '    pub fn pack(&self) -> [u8; PACKET_SIZE] {',
      '        let mut out = [0u8; PACKET_SIZE];', ...lines, '        out', '    }', '}', ''].join('\n')
  }
  const note = encrypted ? (language === 'Python' || language === 'Rust'
    ? '# Encryption is enabled on this device. This file packs payload bytes only; use an encryption-capable transport.\n'
    : '// Encryption is enabled: configure the SDK with the separate encryption key before sending.\n') : ''
  return { filename: `struct_packet_v${version}.${ext}`, source: (language === 'Rust' ? note.replace(/^# /, '// ') : note) + source }
}
