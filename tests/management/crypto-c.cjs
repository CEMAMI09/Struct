const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict'),
  { execFileSync } = require('node:child_process'),
  core = require('../../protocol/management/core.cjs')
async function run() {
  const root = path.resolve(__dirname, '../..'),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-management-c-')),
    source =
      process.env.STRUCT_MBEDTLS_SOURCE ||
      path.join(root, 'work/mbedtls3/mbedtls-3.6.7'),
    zig =
      process.env.STRUCT_ZIG_COMPILER ||
      path.join(root, 'work/fleet/tools/zig-x86_64-windows-0.15.2/zig.exe')
  try {
    const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
      pem = keys.publicKey.export({ type: 'spki', format: 'pem' }),
      manifest = {
        format: 1,
        artifactId: crypto.randomUUID(),
        organizationId: crypto.randomUUID(),
        keyId: crypto.randomUUID(),
        platform: 'esp32',
      identityMode:'persistent-nvs-v1',
        hardwareModel: 'sensor',
        hardwareRevision: 'A',
        version: '2.0.0',
        securityVersion: 2,
        minAgentVersion: 1,
        minimumBootloaderVersion: 1,
        size: 65536,
        sha256: 'ab'.repeat(32),
      },
      canonical = core.canonical(manifest),
      signature = crypto.sign('sha256', canonical, keys.privateKey),
      rootSecret = '12'.repeat(32),
      wire = 0x01234567,
      key = core.managementKey(rootSecret, wire),
      id = crypto.randomUUID(),
      nonce = 'ab'.repeat(32),
      hash = 'cd'.repeat(32),
      mac = core.requestMac(key, wire, id, nonce, hash)
    const arr = (b) => [...b].join(','),
      str = (s) => JSON.stringify(s)
    fs.writeFileSync(
      path.join(dir, 'management_config.h'),
      [
        'MD',
        'SHA256',
        'HKDF',
        'PK',
        'PK_WRITE',
        'PK_PARSE',
        'PEM_PARSE',
        'BASE64',
        'OID',
        'ASN1_PARSE',
        'ASN1_WRITE',
        'BIGNUM',
        'ECP',
        'ECDSA',
        'PLATFORM',
      ]
        .map((x) => '#define MBEDTLS_' + x + '_C')
        .join('\n') +
        '\n#define MBEDTLS_ECP_DP_SECP256R1_ENABLED\n#define MBEDTLS_ECP_NIST_OPTIM\n',
    )
    fs.writeFileSync(
      path.join(dir, 'test.c'),
      `#include <assert.h>\n#include "struct_management_crypto.h"\nint main(void){unsigned char root[32]={${arr(Buffer.from(rootSecret, 'hex'))}},expected[32]={${arr(key)}},key[32],mac[32],fp[32],expected_fp[32]={${arr(Buffer.from(core.fingerprint(pem), 'hex'))}},expected_mac[32]={${arr(Buffer.from(mac, 'hex'))}},signature[]={${arr(signature)}};char canonical[]=${str(canonical.toString())};struct_management_manifest m;assert(!struct_management_fingerprint(${str(pem)},fp));assert(!memcmp(fp,expected_fp,32));assert(!struct_management_derive(root,${wire},key));assert(!memcmp(key,expected,32));assert(!struct_management_mac(key,${wire},${str(id)},${str(nonce)},${str(hash)},mac));assert(!memcmp(mac,expected_mac,32));assert(!struct_management_parse(canonical,strlen(canonical),&m));assert(m.size==65536&&m.security_version==2);assert(!struct_management_verify(${str(pem)},(unsigned char*)canonical,strlen(canonical),signature,sizeof(signature)));canonical[0]^=1;assert(struct_management_verify(${str(pem)},(unsigned char*)canonical,strlen(canonical),signature,sizeof(signature)));assert(struct_management_parse(canonical,strlen(canonical),&m));puts("PASS C/mbedTLS HKDF, HMAC, manifest parsing, P-256 verification and tamper rejection");return 0;}`,
    )
    const output = path.join(dir, 'test.wasm')
    execFileSync(
      zig,
      [
        'cc',
        '-target',
        'wasm32-wasi',
        '-O2',
        '-std=c99',
        '-UNDEBUG',
        '-I' + dir,
        '-I' + path.join(root, 'sdk/c/src'),
        '-I' + path.join(source, 'include'),
        '-DMBEDTLS_CONFIG_FILE="management_config.h"',
        path.join(dir, 'test.c'),
        ...fs
          .readdirSync(path.join(source, 'library'))
          .filter((n) => n.endsWith('.c'))
          .map((n) => path.join(source, 'library', n)),
        '-o',
        output,
      ],
      { stdio: 'inherit', timeout: 180000 },
    )
    const { WASI } = require('node:wasi'),
      wasi = new WASI({ version: 'preview1', returnOnExit: true }),
      module = await WebAssembly.compile(fs.readFileSync(output)),
      instance = await WebAssembly.instantiate(module, wasi.getImportObject())
    assert.equal(wasi.start(instance), 0)
  } finally {
    assert(
      path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(dir).startsWith('struct-management-c-'),
    )
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
