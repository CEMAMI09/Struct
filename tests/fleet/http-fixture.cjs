// Loopback-only disposable PostgreSQL-engine REST/auth fixture. Auth is simulated,
// but Nuxt API handlers, RLS, migrations, worker and enrollment run unchanged.
const http = require('node:http'),
  fs = require('node:fs')
const { fixture } = require('../pipelines/fixture.cjs'),
  { start } = require('../../tcp-server/fleet/worker')
async function main() {
  const f = await fixture(),
    { db, scalar } = f
  await db.exec('update fleet_settings set enabled=true')
  const monitoringWorker=process.env.STRUCT_OBSERVABILITY_FIXTURE==='true'?await require('../observability/fixture.cjs').prepareBrowser(f):null
  await db.query(
    "update organizations set subscription_tier='scale',stripe_quantity=10000,stripe_customer_id='cus_local_fixture',stripe_subscription_id='sub_local_fixture' where id=$1",
    [f.org],
  )
  const managementFixture=process.env.STRUCT_MANAGEMENT_FIXTURE==='true'?await require('../management/fixture.cjs').setup(f):null
  const enterpriseFixture=process.env.STRUCT_ENTERPRISE_FIXTURE==='true'?await require('../enterprise/browser-fixture.cjs').prepare(f):null
  if(managementFixture&&enterpriseFixture){for(const surface of ['desktop','tablet','mobile']){const id=require('node:crypto').randomUUID(),email='owner-'+surface+'@example.invalid';await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'admin')",[f.org,id]);enterpriseFixture.users.push({id,email,aud:'authenticated',role:'authenticated',email_confirmed_at:new Date().toISOString()})}}
  const user = {
    id: f.user,
    email: 'local@example.invalid',
    aud: 'authenticated',
    role: 'authenticated',
    email_confirmed_at: new Date().toISOString(),
  }
  const issued=new Map()
  function makeSession(identity){const token=[{alg:'HS256',typ:'JWT'},{sub:identity.id,aud:'authenticated',role:'authenticated',email:identity.email,exp:Math.floor(Date.now()/1000)+86400},'local-fixture'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');issued.set(token,identity);return{access_token:token,refresh_token:'local-only',token_type:'bearer',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user:identity}}
  const session=makeSession(user),identities=[user,...(enterpriseFixture?.users||[])]
  const adapter = {
    async rpc(name, args = {}) {
      try {
        return { data: await rpc(db, name, args) }
      } catch (e) {
        return { error: { message: e.message } }
      }
    },
  }
  const tables = [
    'fleet_settings',
    'device_groups',
    'device_group_members',
    'fleet_jobs',
    'fleet_job_items',
    'organization_members',
    'organizations',
    'devices',
    'organization_device_usage_periods',
    'schemas',
    'secure_v2_schema_slots',
    'fleet_audit',
    'observability_settings',
    'enterprise_settings',
    'telemetry',
    ...(managementFixture?['management_settings','firmware_signing_keys','firmware_artifacts','device_management_profiles']:[]),
  ]
  const rpc = async (tx, name, args) => {
    if (
      !/^[a-z_]+$/.test(name) ||
      !Object.keys(args).every((k) => /^p_[a-z_]+$/.test(k))
    )
      throw new Error('Invalid RPC')
    const v = Object.values(args).map((v, i) =>
      typeof v==='string' && /^\\x[0-9a-f]+$/i.test(v)
        ? Buffer.from(v.slice(2),'hex')
        : v && typeof v === 'object' && Object.keys(args)[i] !== 'p_ids'
        ? JSON.stringify(v)
        : v,
    )
    return Object.values(
      (
        await tx.query(
          `select ${name==='create_organization'?'to_jsonb(':''}${name}(${Object.keys(args)
            .map((k, i) => `${k}=>$${i + 1}`)
            .join(',')})${name==='create_organization'?')':''}`,
          v,
        )
      ).rows[0],
    )[0]
  }
  const worker = start(adapter)
  const managementWorker=managementFixture?require('../../tcp-server/management/worker').start(adapter):null
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', '*')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') return res.end()
    const url = new URL(req.url, 'http://localhost'),
      path = url.pathname
    if (path === '/__fixture')
      return res.end(
        JSON.stringify({ org: f.org, user: f.user, device: f.device,...(managementFixture?{management:{wireDeviceId:f.wireId,rootSecret:f.root,artifactId:managementFixture.manifest.artifactId}}:{}),...(enterpriseFixture?{otherOrg:enterpriseFixture.otherOrg,users:enterpriseFixture.users.map(u=>({id:u.id,email:u.email}))}:{}) }),
      )
    if (path.includes('/auth/v1/token')){if(!enterpriseFixture)return res.end(JSON.stringify(session));let input='';for await(const part of req)input+=part;const b=JSON.parse(input||'{}'),identity=identities.find(u=>u.email===b.email);if(!identity||b.password!=='fixture-password'){res.statusCode=401;return res.end(JSON.stringify({message:'Invalid credentials'}))}return res.end(JSON.stringify(makeSession(identity)))}
    const identity=enterpriseFixture?issued.get((req.headers.authorization||'').replace(/^Bearer /,'')):user

    if (path.includes('/auth/v1/user')) {
      if (!req.headers.authorization||!identity) {
        res.statusCode = 401
        return res.end(JSON.stringify({ message: 'No session' }))
      }
      return res.end(JSON.stringify(identity))
    }
    if (path.includes('/auth/v1/logout')) return res.end('{}')
    try {
      const isService = req.headers.apikey === 'local-service-key'
      if(enterpriseFixture&&!isService&&!identity){res.statusCode=401;return res.end(JSON.stringify({message:'Fixture session required'}))}
      const data = await db.transaction(async (tx) => {
        await tx.exec(
          `set local role ${isService ? 'service_role' : 'authenticated'}`,
        )
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
          enterpriseFixture?(isService?'':identity.id):f.user,
        ])
        if (path.startsWith('/rest/v1/rpc/')) {
          let body = ''
          for await (const part of req) {
            body += part
            if (body.length > 8 * 1024 * 1024)
              throw new Error('Fixture input limit')
          }
          return rpc(tx, path.split('/').at(-1), body ? JSON.parse(body) : {})
        }
        const table = path.split('/').at(-1)
        if (!tables.includes(table)) return []
        const args = [],
          where = []
        for (const [key, value] of url.searchParams) {
          if (
            !/^[a-z_]+$/.test(key) ||
            ['select', 'order', 'limit', 'offset'].includes(key)
          )
            continue
          const at = value.indexOf('.'),
            op = value.slice(0, at),
            v = value.slice(at + 1)
          if (op === 'not' && v.startsWith('eq.')) {
            args.push(v.slice(3))
            where.push(`${key}<>$${args.length}`)
          } else if (op === 'eq') {
            args.push(v)
            where.push(`${key}=$${args.length}`)
          } else if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
            args.push(v)
            where.push(
              `${key}${{ gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]}$${args.length}`,
            )
          } else if (op === 'in') {
            args.push(v.slice(1, -1).split(','))
            where.push(`${key}=any($${args.length}::uuid[])`)
          }
        }
        const select = url.searchParams.get('select') || '*'
        const columns = select.includes('(')
          ? '*'
          : select
                .split(',')
                .every((c) => /^[a-z_][a-z_0-9]*$/.test(c) || c === '*')
            ? select
            : '*'
        let sql = `select ${columns} from ${table}${where.length ? ' where ' + where.join(' and ') : ''}`
        const orders = (url.searchParams.get('order') || '')
          .split(',')
          .filter(Boolean)
          .map((v) => {
            const [col, dir] = v.split('.')
            return /^[a-z_]+$/.test(col)
              ? `${col} ${dir === 'desc' ? 'desc' : 'asc'}`
              : ''
          })
          .filter(Boolean)
        if (orders.length) sql += ' order by ' + orders.join(',')
        const range = req.headers.range?.split('-').map(Number),
          offset = Number(url.searchParams.get('offset') || range?.[0] || 0),
          limit = Math.min(
            10000,
            Number(
              url.searchParams.get('limit') ||
                (range ? range[1] - range[0] + 1 : 10000),
            ),
          )
        const count = Object.values(
          (
            await tx.query(
              `select count(${table === 'devices' ? 'id' : '*'})::int from ${table}${where.length ? ' where ' + where.join(' and ') : ''}`,
              args,
            )
          ).rows[0],
        )[0]
        res.setHeader('Content-Range', `0-${Math.max(0, count - 1)}/${count}`)
        const rows = (
          await tx.query(sql + ` limit ${limit} offset ${offset}`, args)
        ).rows
        if (table === 'organization_members' && select.includes('organization'))
          for (const r of rows)
            r.organization = (
              await tx.query('select * from organizations where id=$1', [
                r.organization_id,
              ])
            ).rows[0]
        if (
          table === 'device_groups' &&
          select.includes('device_group_members')
        )
          for (const r of rows)
            r.device_group_members = [
              {
                count: Object.values(
                  (
                    await tx.query(
                      'select count(*)::int from device_group_members where group_id=$1',
                      [r.id],
                    )
                  ).rows[0],
                )[0],
              },
            ]
        return req.headers.accept?.includes('vnd.pgrst.object')
          ? rows[0] || null
          : rows
      })
      res.end(JSON.stringify(data))
    } catch (e) {
      res.statusCode = 400
      res.end(
        JSON.stringify({ message: e.message, code: e.code || 'LOCAL_FIXTURE' }),
      )
    }
  })
  await new Promise((resolve) => server.listen(3125, '127.0.0.1', resolve))
  fs.mkdirSync('work/fleet', { recursive: true })
  fs.writeFileSync(
    'work/fleet/fixture.json',
    JSON.stringify({ org: f.org, user: f.user, device: f.device }),
  )
  console.log('Fleet SQL/HTTP fixture ready on loopback 3125')
  async function stop() {
    server.close()
    await worker.stop()
    await monitoringWorker?.stop()
    await managementWorker?.stop()
    await db.close()
  }
  process.once('SIGINT', () => void stop())
  process.once('SIGTERM', () => void stop())
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
