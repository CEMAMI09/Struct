import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { useBinaryParser } from './useBinaryParser'
const require = createRequire(import.meta.url)
const { parsePayload: gatewayParse } = require('../../../tcp-server/parser.js')

it('signs exactly the frame body with Web Crypto', async () => {
  const secret = 'ab'.repeat(32)
  const { body, mac, frame } = await useBinaryParser().buildV2TelemetryFrame({
    keyId: '0123456789abcdef', schemaVersion: 1, secret,
    payload: new Uint8Array([99, 42, 88]).subarray(1, 2),
    nonce: new Uint8Array(12).fill(7), timestampSec: 1700000000,
  })
  expect(body.length).toBe(35)
  expect(body[34]).toBe(42)
  expect(Buffer.from(mac)).toEqual(createHmac('sha256', secret).update(body).digest())
  expect(Buffer.from(frame)).toEqual(Buffer.concat([body, mac]))
})

it('matches the gateway decoder for every supported field type', () => {
  const fields = [
    { name: 'temp', type: 'float32' }, { name: 'count', type: 'int32' },
    { name: 'battery', type: 'uint8' }, { name: 'alive', type: 'boolean' },
    { name: 'status', type: 'flags', bits: [{ name: 'ready', bit: 7 }] },
    { name: 'serial', type: 'char', length: 3 },
  ] as const
  const parser = useBinaryParser()
  const schema = JSON.parse(JSON.stringify(fields))
  const bytes = parser.encodePayload({ temp: 23.5, count: -42, battery: 255, alive: true, status: { ready: true }, serial: 'ABC' }, schema)
  expect(parser.parsePayload(bytes, schema)).toEqual(gatewayParse(Buffer.from(bytes), schema))
})

it('rejects invalid wire metadata instead of truncating it', async () => {
  const options = { keyId: '0123456789abcdef', schemaVersion: 1, secret: 'ab'.repeat(32), payload: new Uint8Array([42]) }
  for (const override of [
    { keyId: 'too-short' }, { secret: 'bad' }, { schemaVersion: 256 },
    { schemaVersion: 0 }, { timestampSec: -1 }, { nonce: new Uint8Array(13) },
    { payload: new Uint8Array(1335) },
  ]) await expect(useBinaryParser().buildV2TelemetryFrame({ ...options, ...override })).rejects.toThrow()
})
