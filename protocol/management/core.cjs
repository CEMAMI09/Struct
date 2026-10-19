'use strict'
const crypto = require('node:crypto')
const FORMAT = 'STRUCT-FIRMWARE-MANIFEST-V1',
  MAX_IMAGE = 4 * 1024 * 1024
const FACTORY_MARKER='STRUCT_FACTORY_CREDENTIAL_IMAGE_V1'
const fields = [
  'artifactId',
  'organizationId',
  'keyId',
  'platform',
  'identityMode',
  'hardwareModel',
  'hardwareRevision',
  'version',
  'securityVersion',
  'minAgentVersion',
  'minimumBootloaderVersion',
  'size',
  'sha256',
]
const uuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    v,
  )
function integer(v, min, max) {
  return Number.isSafeInteger(v) && v >= min && v <= max
}
function canonical(m) {
  if (
    !m ||
    typeof m !== 'object' ||
    Array.isArray(m) ||
    Object.keys(m).sort().join() !== ['format', ...fields].sort().join() ||
    m.format !== 1
  )
    throw Error('Invalid manifest fields')
  for (const f of ['artifactId', 'organizationId', 'keyId'])
    if (!uuid(m[f])) throw Error('Invalid manifest identity')
  if (
    m.identityMode!=='persistent-nvs-v1'||!['esp32', 'esp32c3'].includes(m.platform) ||
    !['hardwareModel', 'hardwareRevision', 'version'].every(
      (f) => typeof m[f] === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(m[f]),
    )
  )
    throw Error('Invalid hardware/version')
  if (
    !integer(m.securityVersion, 0, 0x7fffffff) ||
    m.minAgentVersion !== 1 ||
    !integer(m.minimumBootloaderVersion, 0, 65535) ||
    !integer(m.size, 256, MAX_IMAGE) ||
    !/^[a-f0-9]{64}$/.test(m.sha256)
  )
    throw Error('Invalid manifest bounds')
  return Buffer.from(
    [FORMAT, ...fields.map((f) => String(m[f])), ''].join('\n'),
    'ascii',
  )
}
function publicKey(pem) {
  if (typeof pem !== 'string' || pem.length > 2048 || pem.includes('PRIVATE'))
    throw Error('Public P-256 key required')
  const key = crypto.createPublicKey(pem)
  if (
    key.asymmetricKeyType !== 'ec' ||
    !['prime256v1', 'P-256'].includes(key.asymmetricKeyDetails?.namedCurve)
  )
    throw Error('P-256 key required')
  return key
}
function fingerprint(pem) {
  return crypto
    .createHash('sha256')
    .update(publicKey(pem).export({ format: 'der', type: 'spki' }))
    .digest('hex')
}
function verifyManifest(m, signature, pem) {
  const bytes = canonical(m)
  if (
    typeof signature !== 'string' ||
    signature.length > 128 ||
    !crypto.verify(
      'sha256',
      bytes,
      publicKey(pem),
      Buffer.from(signature, 'base64'),
    )
  )
    throw Error('Firmware signature rejected')
  return bytes
}
function validateImageHeader(header, m) {
  // ESP image header + first segment header + esp_app_desc magic. esp_ota_end
  // performs full platform image validation before selecting a boot partition.
  if (
    header.length < 80 ||
    header[0] !== 0xe9 ||
    header[1] < 1 ||
    header[1] > 16 ||
    header.readUInt16LE(12) !== (m.platform === 'esp32c3' ? 5 : 0) ||
    header.readUInt32LE(32) !== 0xabcd5432
  )
    throw Error('Not a compatible ESP application image')
}
function configuration(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    !Object.keys(value).every((k) =>
      [
        'reportIntervalSeconds',
        'sampleIntervalSeconds',
        'diagnosticLevel',
      ].includes(k),
    ) ||
    !integer(value.reportIntervalSeconds, 10, 86400) ||
    !integer(value.sampleIntervalSeconds, 1, value.reportIntervalSeconds) ||
    !['none', 'error', 'info'].includes(value.diagnosticLevel)
  )
    throw Error('Invalid typed configuration')
  return {
    reportIntervalSeconds: value.reportIntervalSeconds,
    sampleIntervalSeconds: value.sampleIntervalSeconds,
    diagnosticLevel: value.diagnosticLevel,
  }
}
function capabilities(c) {
  if (
    !c ||
    typeof c !== 'object' ||
    !['esp32', 'esp32c3', 'node-test'].includes(c.platform) ||
    !['hardwareModel', 'hardwareRevision', 'firmwareVersion'].every(
      (k) => typeof c[k] === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(c[k]),
    ) ||
    !integer(c.agentVersion, 1, 1) ||
    !integer(c.bootloaderVersion, 0, 65535) ||
    !integer(c.partitionBytes, 0, MAX_IMAGE) ||
    !integer(c.securityVersion, 0, 0x7fffffff) ||
    !Array.isArray(c.keyFingerprints) ||
    c.keyFingerprints.length > 4 ||
    !c.keyFingerprints.every((k) => /^[a-f0-9]{64}$/.test(k)) ||
    typeof c.rollback !== 'boolean' ||
    typeof c.ota !== 'boolean' ||
    typeof c.configuration !== 'boolean'
  )
    throw Error('Invalid management capabilities')
  return Object.fromEntries(
    [
      'platform',
      'hardwareModel',
      'hardwareRevision',
      'firmwareVersion',
      'agentVersion',
      'bootloaderVersion',
      'partitionBytes',
      'securityVersion',
      'keyFingerprints',
      'rollback',
      'ota',
      'configuration',
    ].map((k) => [k, c[k]]),
  )
}
function managementKey(root, wireId) {
  if (!/^[a-f0-9]{64}$/i.test(root) || !integer(wireId, 1, 0xffffffff))
    throw Error('Invalid management identity')
  const salt = Buffer.alloc(4)
  salt.writeUInt32BE(wireId)
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(root, 'hex'),
      salt,
      Buffer.from('struct.management.v1'),
      32,
    ),
  )
}
const digest = (b) => crypto.createHash('sha256').update(b).digest('hex')
function requestMessage(wireId, id, nonce, bodyHash) {
  if (
    !integer(wireId, 1, 0xffffffff) ||
    !uuid(id) ||
    !/^[a-f0-9]{64}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(bodyHash)
  )
    throw Error('Invalid management challenge')
  return `STRUCT-MANAGEMENT-V1\n${wireId}\n${id}\n${nonce}\n${bodyHash}`
}
function requestMac(key, wireId, id, nonce, bodyHash) {
  return crypto
    .createHmac('sha256', key)
    .update(requestMessage(wireId, id, nonce, bodyHash))
    .digest('hex')
}
function authenticate(root, wireId, id, nonce, payload, mac) {
  if (
    typeof payload !== 'string' ||
    payload.length > 22000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload) ||
    typeof mac !== 'string' ||
    !/^[a-f0-9]{64}$/.test(mac)
  )
    throw Error('Management authentication rejected')
  const bytes = Buffer.from(payload, 'base64'),
    hash = digest(bytes)
  if (
    bytes.length > 16384 ||
    bytes.toString('base64') !== payload ||
    !crypto.timingSafeEqual(
      Buffer.from(mac, 'hex'),
      Buffer.from(
        requestMac(managementKey(root, wireId), wireId, id, nonce, hash),
        'hex',
      ),
    )
  )
    throw Error('Management authentication rejected')
  const body = JSON.parse(bytes.toString('utf8'))
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw Error('Invalid management body')
  return { body, hash }
}
module.exports = {
  FORMAT,
  FACTORY_MARKER,
  MAX_IMAGE,
  fields,
  uuid,
  canonical,
  publicKey,
  fingerprint,
  verifyManifest,
  validateImageHeader,
  configuration,
  capabilities,
  managementKey,
  digest,
  requestMac,
  authenticate,
}
