'use strict'
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..')
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'sdk/tests/secure-v2-vectors.json'), 'utf8'))
const columns = ['name', 'rootSecret', 'plaintext', 'nonce', 'downlinkNonce', 'aad', 'ciphertext', 'tag', 'frame', 'receipt']
const keys = ['uplinkKey', 'downlinkKey', 'uplinkPrefix', 'downlinkPrefix']
const source = ['/* Generated TEST-ONLY fixtures; do not provision devices with these roots. */',
  '#ifndef STRUCT_SECURE_V2_TEST_VECTORS_H', '#define STRUCT_SECURE_V2_TEST_VECTORS_H',
  'typedef struct {', ...columns.map(k => `  const char *${k};`), ...keys.map(k => `  const char *${k};`),
  '  uint32_t wireDeviceId, sequence;', '  uint8_t control;', '} struct_v2_test_vector;',
  'static const struct_v2_test_vector struct_v2_test_vectors[] = {',
  ...fixture.vectors.map(v => '  {' + [...columns.map(k => JSON.stringify(v[k])), ...keys.map(k => JSON.stringify(v.keys[k])),
    `UINT32_C(${v.wireDeviceId})`, `UINT32_C(${v.sequence})`, v.control].join(', ') + '},'),
  '};', '#endif', ''].join('\n')
const destination = path.join(root, 'sdk/c/tests/secure_v2_vectors.h')
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== source) throw new Error('C fixture header is stale; run node scripts/generate-secure-v2-c-fixtures.cjs')
} else fs.writeFileSync(destination, source)
console.log(`Secure V2 C fixtures: ${fixture.vectors.length} vectors`)
