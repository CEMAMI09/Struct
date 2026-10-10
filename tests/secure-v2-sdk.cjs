'use strict'
// Native host mbedTLS by default; optional Zig + upstream mbedTLS sources support
// Windows/WASI without changing the SDK or substituting fake crypto callbacks.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const {execFileSync, spawnSync} = require('node:child_process'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const vectors = JSON.parse(fs.readFileSync(path.join(root, 'sdk/tests/secure-v2-vectors.json'), 'utf8')).vectors
execFileSync(process.execPath, [path.join(root, 'scripts/generate-secure-v2-c-fixtures.cjs'), '--check'], {stdio: 'inherit'})
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-v2-sdk-'))
const zig = process.env.STRUCT_ZIG_COMPILER, source = process.env.STRUCT_MBEDTLS_SOURCE
const sdk = path.join(root, 'sdk/c'), output = path.join(build, zig ? 'test.wasm' : (process.platform === 'win32' ? 'test.exe' : 'test'))
async function main() {
  let compiler = process.env.STRUCT_C_COMPILER
  if (!compiler && !zig) compiler = ['cc', 'gcc', 'clang'].find(name => spawnSync(name, ['--version'], {stdio: 'ignore'}).status === 0)
  if (!compiler && !zig) throw new Error('Host C compiler required. Install gcc/clang + mbedTLS, or set STRUCT_ZIG_COMPILER and STRUCT_MBEDTLS_SOURCE for the independent WASI build.')
  const args = zig ? ['cc', '-target', 'wasm32-wasi'] : []
  args.push('-std=c99', '-O2', '-UNDEBUG', '-Wall', '-Wextra', '-I' + path.join(sdk, 'src'), '-I' + path.join(sdk, 'tests'),
    path.join(sdk, 'src/struct_sdk.c'), path.join(sdk, 'src/struct_secure_v2.c'), path.join(sdk, 'src/struct_v2_counter.c'),
    path.join(sdk, 'tests/test_secure_v2.c'))
  if (source) {
    args.push('-I' + path.join(source, 'include'), '-DMBEDTLS_CONFIG_FILE="secure_v2_mbedtls_test_config.h"')
    for (const name of ['md', 'sha256', 'platform', 'platform_util', 'constant_time', 'hkdf', 'chacha20', 'poly1305', 'chachapoly']) args.push(path.join(source, 'library', name + '.c'))
  } else if (zig) throw new Error('STRUCT_MBEDTLS_SOURCE is required for the Zig/WASI build')
  else args.push('-lmbedcrypto')
  args.push('-o', output)
  execFileSync(zig || compiler, args, {stdio: 'inherit', timeout: 180000})
  let log
  if (zig) {
    const {WASI} = require('node:wasi'), logFile = path.join(build, 'output.txt'), fd = fs.openSync(logFile, 'w')
    try {
      const wasi = new WASI({version: 'preview1', stdout: fd, returnOnExit: true})
      const module = await WebAssembly.compile(fs.readFileSync(output))
      const instance = await WebAssembly.instantiate(module, wasi.getImportObject())
      assert.equal(wasi.start(instance), 0, 'C SDK tests failed')
    } finally {fs.closeSync(fd)}
    log = fs.readFileSync(logFile, 'utf8')
  } else log = execFileSync(output, [], {encoding: 'utf8', timeout: 30000})
  const actual = [...log.matchAll(/vector=([^\r\n]+)\r?\nframe=([a-f0-9]*)\r?\nreceipt=([a-f0-9]*)/g)]
  assert.equal(actual.length, vectors.length)
  for (let i = 0; i < vectors.length; ++i) {
    assert.equal(actual[i][1], vectors[i].name); assert.equal(actual[i][2], vectors[i].frame); assert.equal(actual[i][3], vectors[i].receipt)
  }
  assert.match(log, /golden crypto, tampering, durable reservation, reboot\/erase\/rotation, retries and batches passed/)
  console.log(`Independent C/mbedTLS SDK passed ${vectors.length} Node golden vectors, upstream crypto self-tests, byte tampering, persistence, reboot, erase, rotation, bounded retries and batch splitting.`)
}
main().catch(error => {console.error(error.message); process.exitCode = 1}).finally(() => {
  // Only delete the exact, freshly created temporary build directory.
  const resolved = path.resolve(build), temporary = path.resolve(os.tmpdir()) + path.sep
  if (!resolved.startsWith(temporary) || !path.basename(resolved).startsWith('struct-v2-sdk-')) throw new Error('Unsafe build cleanup path')
  fs.rmSync(resolved, {recursive: true, force: true})
})
