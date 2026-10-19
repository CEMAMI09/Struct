// Verify the deployable function without access to checkout node_modules.
// No credentials, production requests, deployments or database writes are used.
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const output = resolve(process.argv[2] || 'web/.vercel/output')
const functions = join(output, 'functions')
const names = (await readdir(functions)).filter((name) => name.endsWith('.func'))
assert(names.length > 0, 'Build with NITRO_PRESET=vercel before checking deployment')
const temporary = await mkdtemp(join(tmpdir(), 'struct-web-function-'))
try {
  // Preserve the relative layout if Nitro emits shared files between functions.
  const isolated = join(temporary, 'output')
  await cp(output, isolated, { recursive: true, dereference: true })
  const candidates = names.filter((name) => /(?:fallback|nitro)/.test(name))
  assert.equal(candidates.length, 1, 'Expected one Nuxt server function')
  const directory = join(isolated, 'functions', candidates[0])
  const config = JSON.parse(await readFile(join(directory, '.vc-config.json'), 'utf8'))
  const entry = resolve(directory, config.handler)
  const inside = relative(directory, entry)
  assert(!inside.startsWith('..' + sep) && !isAbsolute(inside), 'Handler must stay inside function')
  const runner = join(temporary, 'probe.mjs')
  await writeFile(runner, `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { createServer } from 'node:http'
import { relative, isAbsolute, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
const entry = process.argv[2], directory = process.argv[3]
const require = createRequire(entry)
for (const name of ['@aws-sdk/client-sqs', '@aws-sdk/client-eventbridge', '@smithy/node-http-handler', 'ipaddr.js', 'pg']) {
  const resolved = realpathSync(require.resolve(name))
  const inside = relative(directory, resolved)
  assert(!inside.startsWith('..' + sep) && !isAbsolute(inside), name + ' escaped the deployment function')
  require(name)
}
const { default: handler } = await import(pathToFileURL(entry).href)
assert.equal(typeof handler, 'function')
const server = createServer(handler)
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  const base = 'http://127.0.0.1:' + server.address().port
  for (const [path, status] of [
    ['/api/integrations?orgId=00000000-0000-4000-8000-000000000000', 503],
    ['/api/device-operations?orgId=invalid', 400],
    ['/api/fleet?orgId=invalid', 400],
    ['/docs', 200],
  ]) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(10000), redirect: 'manual' })
    const text = await response.text()
    assert.equal(response.status, status, path + ' returned ' + response.status)
    if (status === 200) assert(text.includes('Struct'), 'Missing rendered documentation')
    else assert(response.headers.get('content-type')?.includes('application/json'), 'Expected JSON error response')
    console.log('PASS isolated function HTTP ' + status + ' ' + path)
  }
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
console.log('PASS five packaged runtime dependencies and isolated Vercel function startup on ' + process.version)
process.exit(0)
`, 'utf8')
  const result = spawnSync(process.execPath, [runner, entry, directory], {
    cwd: temporary,
    encoding: 'utf8',
    timeout: 45000,
    env: {
      ...process.env,
      NODE_PATH: '',
      STRUCT_INTEGRATIONS_ENABLED: 'false',
      STRUCT_DEVICE_OPERATIONS_ENABLED: 'false',
      STRUCT_ENTERPRISE_ENABLED: 'false',
      NUXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      SUPABASE_URL: 'http://127.0.0.1:9',
      NUXT_PUBLIC_SUPABASE_KEY: 'local-build-anon-key',
      SUPABASE_KEY: 'local-build-anon-key',
      SUPABASE_SERVICE_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      NUXT_SUPABASE_SERVICE_KEY: '',
    },
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  assert.equal(result.status, 0, 'Isolated deployment function failed')
} finally {
  // Only remove the fresh, verified temporary copy created by this invocation.
  assert.equal(dirname(temporary), resolve(tmpdir()))
  assert(basename(temporary).startsWith('struct-web-function-'))
  await rm(temporary, { recursive: true, force: true })
}
