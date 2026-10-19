const {
    randomUUID,
    randomBytes,
    generateKeyPairSync,
    sign,
  } = require('node:crypto'),
  core = require('../../protocol/management/core.cjs'),
  { fixture } = require('../pipelines/fixture.cjs')
async function setup(existing) {
  const f = existing?.db ? existing : await fixture(existing),
    { db, scalar } = f
  await db.exec(
    'update management_settings set enabled=true;update enterprise_settings set enabled=true;update fleet_settings set enabled=true',
  )
  await db.query(
    "update organizations set subscription_tier='scale',stripe_quantity=20000 where id=$1",
    [f.org],
  )
  const pair = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { format: 'pem', type: 'spki' },
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    }),
    keyId = randomUUID(),
    fingerprint = core.fingerprint(pair.publicKey)
  const admin = (action, data, actor = f.user) =>
    scalar('select management_admin($1,$2,$3,$4,$5)', [
      f.org,
      actor,
      action,
      JSON.stringify(data),
      randomUUID(),
    ])
  await admin('key', {
    id: keyId,
    name: 'Offline fixture',
    publicPem: pair.publicKey,
    fingerprint,
  })
  const image = Buffer.alloc(65536, 0xa5)
  image[0] = 0xe9
  image[1] = 1
  image.writeUInt16LE(0, 12)
  image.writeUInt32LE(0xabcd5432, 32)
  const manifest = {
      format: 1,
      artifactId: randomUUID(),
      organizationId: f.org,
      keyId,
      platform: 'esp32',
      identityMode:'persistent-nvs-v1',
      hardwareModel: 'test-sensor',
      hardwareRevision: 'A',
      version: '1.1.0',
      securityVersion: 1,
      minAgentVersion: 1,
      minimumBootloaderVersion: 1,
      size: image.length,
      sha256: core.digest(image),
    },
    signature = sign(
      'sha256',
      core.canonical(manifest),
      pair.privateKey,
    ).toString('base64')
  core.verifyManifest(manifest, signature, pair.publicKey)
  await admin('artifact', {
    manifest,
    signature,
    canonical: core.canonical(manifest).toString(),
  })
  await admin('uploaded', {
    id: manifest.artifactId,
    size: image.length,
    sha256: manifest.sha256,
  })
  await admin('approve', { id: manifest.artifactId })
  const capabilities = {
    platform: 'esp32',
      
    hardwareModel: 'test-sensor',
    hardwareRevision: 'A',
    firmwareVersion: '1.0.0',
    agentVersion: 1,
    bootloaderVersion: 1,
    partitionBytes: 1900544,
    securityVersion: 0,
    keyFingerprints: [fingerprint],
    rollback: true,
    ota: true,
    configuration: true,
  }
  async function deviceRequest(
    action,
    data = {},
    identity = { wire: f.wireId, root: f.root },
  ) {
    const id = randomUUID(),
      nonce = randomBytes(32).toString('hex'),
      bytes = Buffer.from(JSON.stringify({ action, data })),
      hash = core.digest(bytes),
      payload = bytes.toString('base64'),
      mac = core.requestMac(
        core.managementKey(identity.root, identity.wire),
        identity.wire,
        id,
        nonce,
        hash,
      )
    await scalar('select management_challenge($1,$2,$3,$4)', [
      identity.wire,
      id,
      core.digest(Buffer.from(nonce, 'hex')),
      hash,
    ])
    core.authenticate(identity.root, identity.wire, id, nonce, payload, mac)
    let received = data
    if (action === 'poll') {
      received = {
        downloadId: randomUUID(),
        downloadHash: core.digest(randomBytes(32)),
      }
    }
    return scalar('select management_device($1,$2,$3,$4,$5,$6)', [
      identity.wire,
      id,
      core.digest(Buffer.from(nonce, 'hex')),
      hash,
      action,
      JSON.stringify(received),
    ])
  }
  await deviceRequest('capabilities', capabilities)
  await admin('enable_device', { id: f.device, enabled: true })
  const preview = (definition, request = randomUUID(), actor = f.user) =>
    scalar('select management_preview($1,$2,$3,$4)', [
      f.org,
      actor,
      request,
      JSON.stringify(definition),
    ])
  const definition = {
    kind: 'firmware',
    artifactId: manifest.artifactId,
    selection: { ids: [f.device] },
    wavePercentages: [100],
    manualAdvance: false,
    observationSeconds: 0,
    maxConcurrent: 1,
  }
  return {
    ...f,
    admin,
    deviceRequest,
    preview,
    definition,
    capabilities,
    image,
    manifest,
    signature,
    pair,
    keyId,
    fingerprint,
  }
}
module.exports = { setup }
