// Real offline signer against actual locally compiled ESP32/C3 application images.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { execFileSync } = require('node:child_process'),
  core = require('../../protocol/management/core.cjs')
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-offline-sign-'))
  try {
    const priv = path.join(dir, 'private.pem'),
      pub = path.join(dir, 'public.pem'),
      cli = path.resolve('scripts/firmware-sign.cjs')
    execFileSync(process.execPath, [cli, 'keygen', priv, pub], {
      stdio: 'pipe',
    })
    assert.throws(() =>
      execFileSync(process.execPath, [cli, 'keygen', priv, pub], {
        stdio: 'pipe',
      }),
    )
    const pem = fs.readFileSync(pub, 'utf8'),
      results = []
    for (const [platform, board] of [
      ['esp32', 'esp32dev'],
      ['esp32c3', 'esp32-c3-devkitm-1'],
    ]) {
      const image = path.resolve(
        'work/management/source-' + board + '/.pio/build/struct-ota/firmware.bin',
      )
      if (!fs.existsSync(image))
        throw Error('Build the explicit management example first: ' + board)
      const metadata = {
          artifactId: crypto.randomUUID(),
          organizationId: crypto.randomUUID(),
          keyId: crypto.randomUUID(),
          platform,
        identityMode: 'persistent-nvs-v1',
          hardwareModel: 'test-sensor',
          hardwareRevision: 'A',
          version: 'qualification-' + platform,
          securityVersion: 1,
          minAgentVersion: 1,
          minimumBootloaderVersion: 1,
        },
        meta = path.join(dir, platform + '.json'),
        output = path.join(dir, platform + '-signed.json')
      fs.writeFileSync(meta, JSON.stringify(metadata))
      execFileSync(process.execPath, [cli, 'sign', image, meta, priv, output], {
        stdio: 'pipe',
      })
      const factory=path.resolve('work/management/source-'+board+'/.pio/build/struct/firmware.bin')
      assert(fs.readFileSync(factory).includes(core.FACTORY_MARKER),'Factory build must carry the no-OTA marker')
      assert.throws(()=>execFileSync(process.execPath,[cli,'sign',factory,meta,priv,path.join(dir,platform+'-forbidden.json')],{stdio:'pipe'}))
      const signed = JSON.parse(fs.readFileSync(output)),
        bytes = fs.readFileSync(image)
      assert(!bytes.includes(core.FACTORY_MARKER),'Common image must not contain factory marker')
      assert(!bytes.includes(Buffer.from('12'.repeat(32)))&&!bytes.includes(Buffer.from('12'.repeat(32),'hex')),'Common image excludes compiled per-device root')
      core.verifyManifest(signed.manifest, signed.signature, pem)
      core.validateImageHeader(bytes.subarray(0, 80), signed.manifest)
      assert.equal(signed.manifest.sha256, core.digest(bytes))
      assert.equal(signed.manifest.size, bytes.length)
      results.push({
        platform,
        identityMode: 'persistent-nvs-v1',
        size: bytes.length,
        sha256: signed.manifest.sha256,
        signatureVerified: true,
        physicalInstallation: false,
      })
    }
    fs.writeFileSync(
      'docs/phase-10/evidence/firmware-images.json',
      JSON.stringify(
        {
          at: new Date().toISOString(),
          results,
          boundary:
            'Actual compiled PlatformIO application binaries and offline P-256 CLI signatures; generated examples advertise configuration support, not qualified physical OTA.',
        },
        null,
        2,
      ),
    )
    console.log(
      'PASS offline key protection + signing/verification of actual ESP32 and ESP32-C3 firmware binaries',
    )
  } finally {
    assert(
      path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(dir).startsWith('struct-offline-sign-'),
    )
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
