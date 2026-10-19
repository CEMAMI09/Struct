#!/usr/bin/env node
// Offline only. Private signing keys are never uploaded to Struct.
const fs = require('node:fs'),
  crypto = require('node:crypto'),
  {
    canonical,
    FACTORY_MARKER,
    validateImageHeader,
    digest,
  } = require('../protocol/management/core.cjs')
async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'keygen') {
    if (args.length !== 2) throw Error('keygen PRIVATE_FILE PUBLIC_FILE')
    const pair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
      publicKeyEncoding: { format: 'pem', type: 'spki' },
    })
    fs.writeFileSync(args[0], pair.privateKey, { flag: 'wx', mode: 0o600 })
    fs.writeFileSync(args[1], pair.publicKey, { flag: 'wx', mode: 0o644 })
    console.log('Created offline P-256 key pair; protect the private file')
    return
  }
  if (command !== 'sign' || args.length !== 4)
    throw Error(
      'sign FIRMWARE.bin MANIFEST_METADATA.json PRIVATE_KEY.pem OUTPUT.json',
    )
  const [binary, metadata, keyfile, output] = args,
    m = { ...JSON.parse(fs.readFileSync(metadata, 'utf8')), format: 1 },
    hash = crypto.createHash('sha256')
  let size = 0,
    header = Buffer.alloc(0),tail=Buffer.alloc(0)
  for await (const chunk of fs.createReadStream(binary)) {
    size += chunk.length
    if (size > 4 * 1024 * 1024) throw Error('Firmware exceeds 4 MiB')
    const check=Buffer.concat([tail,chunk]);if(check.includes(FACTORY_MARKER))throw Error('Factory credential image is forbidden for OTA; build struct-ota.');tail=check.subarray(Math.max(0,check.length-FACTORY_MARKER.length+1));
    hash.update(chunk)
    if (header.length < 80)
      header = Buffer.concat([header, chunk]).subarray(0, 80)
  }
  m.size = size
  m.sha256 = hash.digest('hex')
  validateImageHeader(header, m)
  const bytes = canonical(m),
    key = crypto.createPrivateKey(fs.readFileSync(keyfile))
  if (
    key.asymmetricKeyType !== 'ec' ||
    key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  )
    throw Error('P-256 private key required')
  const signature = crypto.sign('sha256', bytes, key).toString('base64')
  fs.writeFileSync(
    output,
    JSON.stringify({ manifest: m, signature }, null, 2) + '\n',
    { flag: 'wx' },
  )
  console.log(
    JSON.stringify({
      artifactId: m.artifactId,
      sha256: m.sha256,
      size,
      manifestDigest: digest(bytes),
    }),
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
