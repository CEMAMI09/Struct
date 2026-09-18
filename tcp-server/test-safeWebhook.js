const assert = require('node:assert/strict')
const { isPublicAddress, validateWebhookUrl } = require('./safeWebhook')
for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254',
  '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
  assert.equal(isPublicAddress(address), false, address)
}
assert(isPublicAddress('1.1.1.1'))
assert(isPublicAddress('2606:4700:4700::1111'))
for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://127.0.0.1',
  'https://2130706433', 'https://[::ffff:127.0.0.1]', 'https://localhost']) assert.throws(() => validateWebhookUrl(url))
assert.equal(validateWebhookUrl('https://example.com/hook').pathname, '/hook')
console.log('webhook SSRF: HTTPS, credentials, private/mapped IPs and alternate IP notation passed')
