import { describe, expect, it } from 'vitest'
import { generateSchemaCode, validateSchema, CODE_LANGUAGES } from './schemaCodegen'
import type { SchemaField } from '../app/types'
const fields: SchemaField[] = [
  { name: 'temperature', type: 'float32' }, { name: 'count', type: 'int32' },
  { name: 'alive', type: 'boolean' }, { name: 'level', type: 'uint8' },
  { name: 'status', type: 'flags', bits: [{ name: 'ready', bit: 0 }, { name: 'fault', bit: 7 }] },
  { name: 'device_id', type: 'char', length: 3 },
]
describe('schema code generation', () => {
  it('exports every requested language', () => {
    for (const language of CODE_LANGUAGES) expect(generateSchemaCode(fields, 7, language).source.length).toBeGreaterThan(100)
  })
  it('executes the generated JavaScript and packs exact LE bytes', async () => {
    const source = generateSchemaCode(fields, 7, 'JavaScript').source
    const generated = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    const values = { temperature: 23.5, count: -42, alive: true, level: 255, status: { ready: true, fault: true }, device_id: new Uint8Array([0, 128, 255]) }
    expect(Buffer.from(generated.pack(values)).toString('hex')).toBe('0000bc41d6ffffff01ff810080ff')
    expect(() => generated.pack({ ...values, level: 256 })).toThrow('range')
    expect(() => generated.pack({ ...values, count: 1.2 })).toThrow('range')
    expect(() => generated.pack({ ...values, device_id: '0080ff' })).toThrow('raw bytes')
    expect(() => generated.pack({ ...values, temperature: NaN })).toThrow('range')
  })
  it('rejects duplicate names, malformed flags, empty schemas and oversize frames', () => {
    expect(() => validateSchema([fields[0], fields[0]])).toThrow('Duplicate')
    expect(() => validateSchema([{ name: 'x', type: 'flags', bits: [{ name: 'ok', bit: 1.1 }] }])).toThrow('bit')
    expect(() => validateSchema([{ name: '__proto__', type: 'uint8' }])).toThrow('reserved')
    expect(() => validateSchema([])).toThrow('least one')
    expect(() => generateSchemaCode(fields, 256, 'C')).toThrow('1..255')
    expect(() => validateSchema(Array.from({ length: 21 }, (_, i) => ({ name: `f${i}`, type: 'char', length: 64 })))).toThrow('1400')
  })
  it('does not depend on native packing or language keywords', () => {
    const c = generateSchemaCode([{ name: 'class', type: 'float32' }], 1, 'C++').source
    expect(c).toContain('float f_class')
    expect(c).toContain('struct_put_f32')
    expect(c).not.toContain('#pragma pack')
    const rust = generateSchemaCode(fields, 1, 'Rust').source
    expect(rust).toContain('to_le_bytes()')
    expect(rust).toContain('[u8; 3]')
  })
})
