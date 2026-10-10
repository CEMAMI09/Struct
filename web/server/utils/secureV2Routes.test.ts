import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'

const { createDatabase } = createRequire(import.meta.url)('../../../tests/database.cjs')
const user = '70000000-0000-0000-0000-000000000001'
const org = '70000000-0000-0000-0000-000000000002'
const device = '70000000-0000-0000-0000-000000000003'
let db: any, role = 'owner', enabled = true
let enroll: any, metadata: any, publish: any, project: any, bootstrap: any
const previousKey = process.env.TCP_CREDENTIAL_KEY
const event = (body: unknown = {}, query: unknown = {}) => ({ body, query, headers: {} as Record<string, string> })

beforeAll(async () => {
  process.env.TCP_CREDENTIAL_KEY = '12'.repeat(32) // TEST ONLY
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('readBody', async (request: any) => request.body)
  vi.stubGlobal('getQuery', (request: any) => request.query)
  vi.stubGlobal('getRouterParam', () => device)
  vi.stubGlobal('setHeader', (request: any, key: string, value: string) => { request.headers[key] = value })
  vi.stubGlobal('useRuntimeConfig', () => ({ secureV2Enabled: enabled }))
  vi.stubGlobal('createError', (input: any) => Object.assign(new Error(input.message), { statusCode: input.statusCode }))
  db = await createDatabase()
  await db.query('insert into auth.users values($1,$2)', [user, 'v2-routes@example.invalid'])
  await db.query('insert into organizations(id,name) values($1,$2)', [org, 'Route tests'])
  await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')", [org, user])
  await db.query(`insert into devices(id,user_id,organization_id,name,api_key,key_id,api_secret_encrypted)
    values($1,$2,$3,'Route sensor','v2routelegacy001','v2routelegacy001','v1:unchanged')`, [device, user, org])
  // Exercise actual handlers, at-rest encryption, SQL functions and constraints.
  // Only the Supabase HTTP/auth boundary is substituted with a local adapter.
  const adapter = {
    from(table: string) {
      if (!['devices', 'secure_v2_credentials', 'secure_v2_schema_slots'].includes(table)) throw new Error('Unexpected table')
      const filters: [string, unknown][] = []
      let columns = '*', ordering = ''
      const query: any = {
        select(value: string) { if (!/^[a-z0-9_,*]+$/.test(value)) throw new Error('Unsafe columns'); columns = value; return query },
        eq(column: string, value: unknown) { if (!/^[a-z_]+$/.test(column)) throw new Error('Unsafe filter'); filters.push([column, value]); return query },
        order(column: string) { if (!/^[a-z_]+$/.test(column)) throw new Error('Unsafe order'); ordering = ` order by ${column}`; return query },
        async execute() {
          const where = filters.map(([column], i) => `${column}=$${i + 1}`).join(' and ')
          return (await db.query(`select ${columns} from ${table}${where ? ` where ${where}` : ''}${ordering}`, filters.map(([, value]) => value))).rows
        },
        async single() { return { data: (await query.execute())[0] ?? null, error: null } },
        async maybeSingle() { return query.single() },
        then(resolve: any, reject: any) { return query.execute().then((data: unknown) => resolve({ data, error: null }), reject) },
      }
      return query
    },
    async rpc(name: string, args: Record<string, any>) {
      const names: Record<string, string[]> = {
        enroll_device_secure_v2: ['device_id', 'org_id', 'root_secret_encrypted', 'secret_preview', 'bootstrap_token_encrypted', 'bootstrap_token_hash', 'rotate', 'grace_seconds'],
        publish_secure_v2_schema_slot: ['device_id', 'org_id', 'slot', 'encoding', 'definition', 'record_bytes', 'legacy_schema_version', 'sample_interval_ms'],
        bootstrap_secure_v2_counter: ['wire_device_id', 'token_hash'],
      }
      if (!names[name]) throw new Error('Unexpected RPC')
      const values = names[name].map(key => {
        const value = args[`p_${key}`]
        if (key.endsWith('_hash')) return Buffer.from(value.slice(2), 'hex')
        return key === 'definition' ? JSON.stringify(value) : value
      })
      try {
        const result = (await db.query(`select to_jsonb(${name}(${values.map((_, i) => `$${i + 1}`).join(',')})) as result`, values)).rows[0].result
        return { data: result, error: null }
      } catch (error: any) { return { data: null, error: { message: error.message } } }
    },
  }
  vi.mocked(serverSupabaseServiceRole).mockResolvedValue(adapter as never)
  vi.mocked(serverSupabaseClient).mockImplementation(async () => {
    const membership: any = { select: () => membership, eq: () => membership,
      maybeSingle: async () => ({ data: role ? { role } : null, error: null }) }
    return { auth: { getUser: async () => ({ data: { user: { id: user } }, error: null }) }, from: () => membership } as never
  })
  enroll = (await import('../api/devices/[id]/secure-v2.post')).default
  metadata = (await import('../api/devices/[id]/secure-v2.get')).default
  publish = (await import('../api/devices/[id]/secure-v2/slots.post')).default
  project = (await import('../api/devices/[id]/secure-v2/project.post')).default
  bootstrap = (await import('../api/secure-v2/bootstrap.post')).default
}, 30000)

afterAll(async () => {
  if (db) await db.close()
  if (previousKey === undefined) delete process.env.TCP_CREDENTIAL_KEY
  else process.env.TCP_CREDENTIAL_KEY = previousKey
  vi.unstubAllGlobals()
})

describe('Secure V2 API → encrypted credentials → PostgreSQL → response', () => {
  it('enrolls, publishes, exports and consumes provisioning once without leaking secrets into metadata', async () => {
    enabled = false
    expect(await metadata(event({}, { orgId: org }))).toMatchObject({ available: false, enabled: false })
    await expect(enroll(event({ orgId: org, action: 'enroll' }))).rejects.toMatchObject({ statusCode: 503 })
    enabled = true
    role = 'viewer'
    await expect(enroll(event({ orgId: org, action: 'enroll' }))).rejects.toMatchObject({ statusCode: 403 })
    role = 'owner'
    await expect(enroll(event({ orgId: 123, action: 'enroll' }))).rejects.toMatchObject({ statusCode: 400 })
    const request = event({ orgId: org, action: 'enroll' })
    const enrolled = await enroll(request)
    expect(request.headers['Cache-Control']).toBe('private, no-store')
    expect(enrolled.credentials.rootSecret).toMatch(/^[a-f0-9]{64}$/)
    expect(enrolled.credentials.bootstrapToken).not.toBe(enrolled.credentials.rootSecret)
    const saved = (await db.query('select * from secure_v2_credentials')).rows[0]
    expect(saved.root_secret_encrypted).toMatch(/^v1:/)
    expect(saved.root_secret_encrypted).not.toContain(enrolled.credentials.rootSecret)
    const definition = [{ name: 'temperature', type: 'fixed', min: -40, max: 125, precision: 0.1 },
      { name: 'humidity', type: 'fixed', min: 0, max: 100, precision: 0.1 }, { name: 'active', type: 'boolean' }]
    expect(await publish(event({ orgId: org, slot: 0, encoding: 'bitpacked-v1', schemaDefinition: definition }))).toMatchObject({ slot: 0, record_bytes: 3 })
    const publicResult = await metadata(event({}, { orgId: org }))
    expect(publicResult).toMatchObject({ available: true, enabled: true, wireDeviceId: enrolled.credentials.wireDeviceId })
    for (const secret of [enrolled.credentials.rootSecret, enrolled.credentials.bootstrapToken, saved.root_secret_encrypted]) {
      expect(JSON.stringify(publicResult)).not.toContain(secret)
    }
    role = 'viewer'
    await expect(project(event({ orgId: org }))).rejects.toMatchObject({ statusCode: 403 })
    role = 'owner'
    const exportRequest = event({ orgId: org })
    expect((await project(exportRequest)).credentials).toEqual(enrolled.credentials)
    expect(exportRequest.headers['Cache-Control']).toBe('private, no-store')
    const provisioning = { wireDeviceId: enrolled.credentials.wireDeviceId, bootstrapToken: enrolled.credentials.bootstrapToken }
    expect(await bootstrap(event(provisioning))).toEqual({ nextSequence: 0 })
    await expect(bootstrap(event(provisioning))).rejects.toMatchObject({ statusCode: 409 })
    const rotated = await enroll(event({ orgId: org, action: 'rotate', graceSeconds: 0 }))
    expect(rotated.credentials.wireDeviceId).not.toBe(enrolled.credentials.wireDeviceId)
    expect(rotated.credentials.rootSecret).not.toBe(enrolled.credentials.rootSecret)
    expect(rotated.slots).toHaveLength(1)
    expect((await db.query('select api_secret_encrypted from devices')).rows[0].api_secret_encrypted).toBe('v1:unchanged')
  })
})
