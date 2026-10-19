const { fixture } = require('../pipelines/fixture.cjs')
async function setup(existing) {
  const f = existing || (await fixture())
  await f.db.exec('update observability_settings set enabled=true')
  const original = f.adapter.rpc.bind(f.adapter)
  f.adapter.rpc = async (name, args = {}) => {
    if (
      ![
        'ingest_secure_v2_observed',
        'record_metric_observations',
        'observability_tick',
        'claim_alert_email',
        'finish_alert_email',
        'observability_cleanup',
      ].includes(name)
    )
      return original(name, args)
    try {
      const values = Object.values(args).map((v) =>
        v && typeof v === 'object'
          ? JSON.stringify(v)
          : typeof v === 'string' && v.startsWith('\\x')
            ? Buffer.from(v.slice(2), 'hex')
            : v,
      )
      return {
        data: await f.scalar(
          `select ${name}(${Object.keys(args)
            .map((k, i) => `${k}=>$${i + 1}`)
            .join(',')})`,
          values,
        ),
      }
    } catch (e) {
      return { error: { message: e.message } }
    }
  }
  f.command = (action, data = {}) =>
    f.scalar('select observability_command($1,$2,$3,$4)', [
      f.org,
      f.user,
      action,
      JSON.stringify(data),
    ])
  return f
}
async function prepareBrowser(f) {
  await setup(f)
  const { processFrame } = require('../../tcp-server/ingest')
  await processFrame(f.frame(0), {
    supabase: f.adapter,
    transport: 'udp',
    ipVersion: 4,
  })
  await f.command('preferences', {
    mode: 'scheduled',
    interval: 60,
    grace: 180,
    timezone: 'UTC',
  })
  const { randomUUID } = require('node:crypto')
  for (const [name, seen] of [
    ['Inactive fixture', true],
    ['Never fixture', false],
  ])
    await f.db.query(
      'insert into devices(id,user_id,organization_id,name,api_key,key_id,first_telemetry_at,last_monitored_commit_at) values($1,$2,$3,$4,$5,$5,$6,$6)',
      [
        randomUUID(),
        f.user,
        f.org,
        name,
        randomUUID(),
        seen ? new Date(Date.now() - 3600000).toISOString() : null,
      ],
    )
  return require('../../tcp-server/observability/worker').start(f.adapter)
}
module.exports = { setup, prepareBrowser }
