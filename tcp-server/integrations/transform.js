const { fail, validateMapping } = require('./config')
function get(value, path) {
  return path
    .split('.')
    .reduce((v, p) => (v && Object.hasOwn(v, p) ? v[p] : undefined), value)
}
function transform(body, snapshot) {
  const mapping = validateMapping(snapshot.mapping),
    source = body.payload,
    values = Object.create(null)
  if (mapping.fields.length)
    for (const f of mapping.fields) {
      let v = get(source, f.from)
      if (v === undefined) {
        if (f.required) fail(`Required mapped field missing: ${f.from}`)
        continue
      }
      if (f.convert === 'string') {
        if (typeof v === 'object')
          fail('Cannot stringify a structured field implicitly')
        v = String(v)
      }
      if (f.convert === 'boolean') {
        if (![true, false, 'true', 'false', 0, 1].includes(v))
          fail('Boolean conversion needs true/false or 0/1')
        v = v === true || v === 'true' || v === 1
      }
      values[f.to] = v
    }
  else Object.assign(values, source)
  const output = {
    format_version: 'struct.event.v1',
    event_id: body.id,
    event_type: body.type || 'telemetry.received',
  }
  if (mapping.metadata.includes('device_id')) output.device_id = body.device_id
  if (mapping.metadata.includes('timestamp')) output.timestamp = body.timestamp
  if (mapping.metadata.includes('schema'))
    output.schema = {
      slot: snapshot.schema_slot,
      version: snapshot.schema_version,
    }
  if (mapping.format === 'flat-v1') {
    for (const k of Object.keys(values))
      if (
        [
          'event_id',
          'format_version',
          'event_type',
          'device_id',
          'timestamp',
          'schema',
          '__proto__',
          'constructor',
          'prototype',
        ].includes(k)
      )
        fail(
          'Payload field conflicts with envelope metadata; map it explicitly',
        )
    Object.assign(output, values)
  } else output.data = values
  const serialized = JSON.stringify(output)
  if (Buffer.byteLength(serialized) > 240000)
    fail('Transformed event exceeds 240000-byte integration limit')
  return { value: output, serialized }
}
module.exports = { transform, get }
