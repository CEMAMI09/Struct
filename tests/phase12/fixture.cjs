// Disposable browser fixture. Not an authentication server; never expose outside loopback.
const http=require('node:http'); const uid='10000000-0000-0000-0000-000000000001',org='10000000-0000-0000-0000-000000000002',device='10000000-0000-0000-0000-000000000003';
const user={id:uid,email:'local@example.invalid',aud:'authenticated',role:'authenticated',email_confirmed_at:new Date().toISOString()};
const token=[{alg:'HS256',typ:'JWT'},{sub:uid,aud:'authenticated',role:'authenticated',email:user.email,exp:Math.floor(Date.now()/1000)+86400},'local-fixture'].map(x=>typeof x==='string'?Buffer.from(x).toString('base64url'):Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
const session={access_token:token,refresh_token:'local-only',token_type:'bearer',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user};
http.createServer(async(req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','*');res.setHeader('Content-Type','application/json');if(req.method==='OPTIONS')return res.end();const path=new URL(req.url,'http://localhost').pathname;let out=[];
if(path.includes('/auth/v1/token'))out=session;else if(path.includes('/auth/v1/user'))out=user;
else if(path.endsWith('/organization_members'))out=[{id:uid,user_id:uid,organization_id:org,role:'owner',organization:{id:org,name:'Local workspace',subscription_tier:'free',stripe_quantity:0,stripe_customer_id:null,stripe_subscription_id:null},created_at:'2026-01-01'}];
else if(path.endsWith('/devices'))out=[{id:device,user_id:uid,organization_id:org,name:'Local sensor',api_key:'fixture-key',key_id:'fixture-key',protocol_version:2,secure_v2_enabled:true,last_seen:'2026-01-01',created_at:'2026-01-01',tags:{},encryption_enabled:false}];
else if(path.endsWith('/schemas'))out=[{id:device,device_id:device,organization_id:org,schema_definition:[{name:'temperature',type:'float32'}],version:1}];
else if(path.includes('/rpc/workspace_onboarding'))out={first_packet_at:'2026-01-01T00:00:00Z',dismissed_at:null};
res.end(JSON.stringify(out));}).listen(Number(process.env.PHASE12_FIXTURE_PORT||3105),'127.0.0.1',()=>console.log('Local fixture Supabase (loopback only)'));
