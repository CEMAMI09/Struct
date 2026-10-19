const assert = require('node:assert/strict'),
  {
    randomUUID,
    generateKeyPairSync,
    sign,
    randomBytes,
  } = require('node:crypto'),
  core = require('../../protocol/management/core.cjs')
let n = 0
const check = (v, m) => {
    assert(v, m)
    n++
  },
  reject = (f) => {
    assert.throws(f)
    n++
  }
const keys = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { format: 'pem', type: 'spki' },
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  }),
  m = {
    format: 1,
    artifactId: randomUUID(),
    organizationId: randomUUID(),
    keyId: randomUUID(),
    platform: 'esp32c3',
    identityMode:'persistent-nvs-v1',
    hardwareModel: 'sensor',
    hardwareRevision: 'B',
    version: '2.0.0',
    securityVersion: 7,
    minAgentVersion: 1,
    minimumBootloaderVersion: 1,
    size: 65536,
    sha256: '12'.repeat(32),
  },
  canonical = core.canonical(m),
  signature = sign('sha256', canonical, keys.privateKey).toString('base64')
check(
  core.verifyManifest(m, signature, keys.publicKey).equals(canonical),
  'real P-256 signature verified',
)
for (const field of [
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
]) {
  const changed = {
    ...m,
    [field]:
      typeof m[field] === 'number'
        ? m[field] + 1
        : field.endsWith('Id')
          ? randomUUID()
          : m[field] + 'x',
  }
  reject(() => core.verifyManifest(changed, signature, keys.publicKey))
}
reject(() => core.canonical({ ...m, extra: 'ambiguity' }))
reject(() => core.canonical({ ...m, hardwareModel: 'sensor\nforged' }))
reject(() => core.publicKey(keys.privateKey))
reject(() => core.canonical({ ...m, size: 4194305 }))
const root = randomBytes(32).toString('hex'),
  wire = 7,
  key = core.managementKey(root, wire),
  id = randomUUID(),
  nonce = randomBytes(32).toString('hex'),
  bytes = Buffer.from('{"action":"poll"}'),
  hash = core.digest(bytes),
  mac = core.requestMac(key, wire, id, nonce, hash)
check(
  core.authenticate(root, wire, id, nonce, bytes.toString('base64'), mac).body
    .action === 'poll',
  'domain-separated HMAC authenticates exact bytes',
)
check(
  !key.equals(Buffer.from(root, 'hex')),
  'management key differs from raw device root',
)
check(
  !key.equals(core.managementKey(root, wire + 1)),
  'wire epoch participates in derivation',
)
reject(() =>
  core.authenticate(
    root,
    wire,
    id,
    nonce,
    Buffer.from('{"action":"report"}').toString('base64'),
    mac,
  ),
)
reject(() =>
  core.authenticate(root, wire + 1, id, nonce, bytes.toString('base64'), mac),
)
check(
  core.configuration({
    reportIntervalSeconds: 300,
    sampleIntervalSeconds: 60,
    diagnosticLevel: 'error',
  }).reportIntervalSeconds === 300,
  'typed configuration',
)
for (const c of [
  {
    reportIntervalSeconds: 0,
    sampleIntervalSeconds: 1,
    diagnosticLevel: 'info',
  },
  {
    reportIntervalSeconds: 60,
    sampleIntervalSeconds: 61,
    diagnosticLevel: 'info',
  },
  {
    reportIntervalSeconds: 60,
    sampleIntervalSeconds: 1,
    diagnosticLevel: 'info',
    password: 'secret',
  },
  {
    reportIntervalSeconds: '60',
    sampleIntervalSeconds: 1,
    diagnosticLevel: 'info',
  },
])
  reject(() => core.configuration(c))
console.log(
  `PASS ${n} real signature/key-separation/manifest/configuration checks`,
)
