// Operator CLI only: private service credentials, no public diagnostic endpoint.
if(require.main===module)require('dotenv').config()
const {createClient}=require('@supabase/supabase-js')
async function main(){const component=process.argv[2];if(!['gateway','delivery','fleet','observability','enterprise','web','management'].includes(component)||!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error();const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init={})=>fetch(url,{...init,signal:AbortSignal.timeout(5000)})}}),r=await db.from('enterprise_heartbeats').select('ready,observed_at').eq('component',component).order('observed_at',{ascending:false}).limit(1).maybeSingle();if(r.error||!r.data||!r.data.ready||Date.now()-Date.parse(r.data.observed_at)>90000)throw Error();console.log(JSON.stringify({component,state:'ready',observedAt:r.data.observed_at,boundary:'Sampled private process/dependency readiness'}))}
if(require.main===module)main().catch(()=>{console.error('Service readiness unavailable, degraded or stale');process.exitCode=1})
module.exports={main}
