import {test,expect,type Page} from '@playwright/test'
import {unzipSync} from 'fflate'
import {readFileSync} from 'node:fs'
const uid='10000000-0000-0000-0000-000000000001',org='10000000-0000-0000-0000-000000000002',id='10000000-0000-0000-0000-000000000003'
const schema=[{name:'temperature',type:'fixed',min:-40,max:125,precision:.1},{name:'humidity',type:'fixed',min:0,max:100,precision:.1},{name:'active',type:'boolean'}]
const slots=[{slot:0,encoding:'bitpacked-v1',record_bytes:3,schema_definition:schema}]
async function fixture(page:Page,returning=false){
 const state={first:returning?'2026-01-01T00:00:00Z':null as string|null,dismissed:null as string|null,syncError:false,syncCount:0,paid:false,downloaded:false}
 await page.route('**/rest/v1/**',async r=>{const path=new URL(r.request().url()).pathname;let json:any=[]
 if(path.endsWith('/organization_members'))json=[{id:uid,user_id:uid,organization_id:org,role:'owner',created_at:'2026-01-01',organization:{id:org,name:'Local workspace',subscription_tier:state.paid?'pro':'free',stripe_quantity:state.paid?150:0,stripe_customer_id:null}}]
 else if(path.endsWith('/devices'))json=[{id,user_id:uid,organization_id:org,name:'Local sensor',api_key:'fixture-key',key_id:'fixture-key',protocol_version:2,secure_v2_enabled:true,wire_device_id:42,last_seen:returning?'2026-01-01':null,first_telemetry_at:state.first,created_at:'2026-01-01',tags:{}},...(returning?[{id:'10000000-0000-0000-0000-000000000004',user_id:uid,organization_id:org,name:'New sensor',secure_v2_enabled:true,wire_device_id:43,last_seen:null,created_at:'2026-01-01',tags:{}}]:[])]
 else if(path.endsWith('/rpc/workspace_onboarding'))json={first_packet_at:state.first,dismissed_at:state.dismissed,schema_device_ids:[id]}
 else if(path.endsWith('/rpc/dismiss_workspace_onboarding')){state.dismissed=new Date().toISOString();json=null}
 else if(path.endsWith('/rpc/update_device_setup')){state.downloaded=true;json=null}
 else if(path.endsWith('/telemetry'))json=[]
 await r.fulfill({json})
 })
 // Block every API mutation from reaching any real service; all credentials are disposable fixtures.
 await page.route('**/api/**',async r=>{const path=new URL(r.request().url()).pathname
 if(path==='/api/stripe/sync'){state.syncCount++;await new Promise(resolve=>setTimeout(resolve,300));return r.fulfill(state.syncError?{status:503,json:{message:'Fixture outage'}}:{json:{ok:true,synced:state.paid,subscriptionTier:state.paid?'pro':'free',stripeQuantity:state.paid?150:0,deviceLimit:state.paid?155:5}})}
 if(path.endsWith('/secure-v2/project'))return r.fulfill({json:{slots,credentials:{wireDeviceId:42,rootSecret:'ab'.repeat(32),bootstrapToken:'cd'.repeat(32)}}})
 if(path.endsWith('/secure-v2'))return r.fulfill({json:{available:true,enabled:true,wireDeviceId:42,slots}})
 if(path==='/api/devices')return r.fulfill({status:402,json:{message:'Device allowance reached: 5 of 5 devices in use. Review Billing to add capacity.'}})
 return r.fulfill({json:{deviceLimit:state.paid?155:5,peakPaidQuantity:state.paid?150:0}})
 });return state
}
async function login(page:Page,destination='/dashboard'){
 await page.goto('/login?redirect='+encodeURIComponent(destination));await page.waitForFunction(()=>!!(document.querySelector('#__nuxt') as any)?.__vue_app__)
 await expect(page.getByLabel('Email',{exact:true})).toBeEnabled();await page.getByLabel('Email',{exact:true}).fill('local@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(new URL(destination,page.url()).href);await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible()
}
test('direct auth destination, durable dismissal, refresh and logout/login',async({page})=>{
 const state=await fixture(page);const paths:string[]=[];page.on('framenavigated',f=>{if(f===page.mainFrame())paths.push(new URL(f.url()).pathname)})
 await login(page);await expect(page.getByRole('heading',{name:'Send your first Secure V2 reading',exact:true})).toBeVisible();expect(paths).not.toContain('/')
 await page.getByRole('button',{name:'Dismiss guide',exact:true}).click();await expect(page.getByRole('heading',{name:'Send your first Secure V2 reading',exact:true})).toHaveCount(0);expect(state.dismissed).toBeTruthy()
 await page.reload();await page.waitForFunction(()=>!!(document.querySelector('#__nuxt') as any)?.__vue_app__);await expect(page.getByRole('button',{name:'Getting Started',exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/\/login$/);await login(page);await expect(page.getByRole('heading',{name:'Send your first Secure V2 reading',exact:true})).toHaveCount(0)
})
test('returning account, expired history, inactive vs never, mobile keyboard menu',async({page},testInfo)=>{
 await fixture(page,true);await login(page);await expect(page.getByRole('heading',{name:'Send your first Secure V2 reading',exact:true})).toHaveCount(0)
 await page.goto('/dashboard/devices');await expect(page.getByText('Inactive',{exact:true})).toBeVisible();await expect(page.getByText('Never connected',{exact:true})).toBeVisible();await page.getByRole('checkbox',{name:'Inactive devices'}).check();await expect(page.getByText('New sensor',{exact:true})).toHaveCount(0)
 if(testInfo.project.name==='mobile'){await expect(page.locator('aside')).toHaveAttribute('inert','');await page.getByRole('button',{name:'Open menu',exact:true}).click();await expect(page.locator('aside')).not.toHaveAttribute('inert','');await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Open menu',exact:true})).toBeFocused()}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../work/phase12/'+testInfo.project.name+'-devices.png',fullPage:true})
 await page.goto('/dashboard/getting-started?device=10000000-0000-0000-0000-000000000004');await expect(page.getByText('Receive and inspect telemetry').locator('..')).not.toContainText('Complete')
})
test('billing pending state clears stale errors and refreshes Free/paid information',async({page})=>{
 const state=await fixture(page,true);await login(page,'/dashboard/settings');state.syncError=true;await page.getByRole('button',{name:'Refresh billing',exact:true}).click();await expect(page.getByText('Unable to refresh billing information. Please try again.',{exact:true})).toBeVisible();state.syncError=false
 await page.getByRole('button',{name:'Refresh billing',exact:true}).click();await expect(page.getByRole('button',{name:'Refreshing…',exact:true})).toBeDisabled();await expect(page.getByText('Unable to refresh billing information. Please try again.',{exact:true})).toHaveCount(0);await expect(page.getByText('You’re currently using the Free plan.',{exact:true})).toBeVisible();expect(state.syncCount).toBe(2)
 state.paid=true;await page.getByRole('button',{name:'Refresh billing',exact:true}).click();await expect(page.getByText('Billing information is up to date.',{exact:true})).toBeVisible();await expect(page.getByText('155 device limit',{exact:true})).toBeVisible()
})
test('current Secure V2 setup exports a complete Node project; capacity errors explain next steps',async({page})=>{
 const state=await fixture(page);await login(page,'/dashboard/schema');await expect(page.getByRole('heading',{name:'Download your starter project'})).toBeVisible();await expect(page.getByRole('tab',{name:/legacy/i})).toHaveCount(0)
 await page.waitForTimeout(500);await page.getByLabel('Platform',{exact:true}).selectOption('node');await expect(page.getByRole('button',{name:'Download private Node starter',exact:true})).toBeVisible();const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download private Node starter',exact:true}).click();const download=await downloaded,files=unzipSync(new Uint8Array(readFileSync((await download.path())!)));expect(files['send.cjs']).toBeTruthy();expect(files['sdk/bitpacked.cjs']).toBeTruthy();expect(JSON.parse(new TextDecoder().decode(files['private-config.json'])).host).toBe('ingest.usestruct.com');await expect.poll(()=>state.downloaded).toBe(true)
 await page.goto('/dashboard/devices?create=1');await page.getByLabel('Device name',{exact:true}).fill('Extra sensor');await page.getByRole('button',{name:'Create',exact:true}).click();await expect(page.getByText(/Device allowance reached: 5 of 5/)).toBeVisible();await expect(page.getByRole('link',{name:'Review usage and Billing'})).toBeVisible()
})
test('documentation search, all task routes, commands and responsive layout',async({page},testInfo)=>{
 await fixture(page);await page.goto('/docs');await page.waitForFunction(()=>!!(document.querySelector('#__nuxt') as any)?.__vue_app__);await page.getByLabel('Search guides').fill('Wi-Fi');await expect(page.getByRole('link',{name:/Send your first Secure V2 reading/})).toBeVisible();await page.getByLabel('Search guides').fill('no-such-topic-7');await expect(page.getByText(/No guides match/)).toBeVisible()
 for(const slug of ['getting-started','devices','schemas','secure-v2','sdks','telemetry','webhooks','billing','troubleshooting','compatibility']){const response=await page.goto('/docs/'+slug);expect(response?.status()).toBe(200);await expect(page.locator('h1')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
 await page.goto('/docs/getting-started');await expect(page.getByText('node send.cjs',{exact:false}).first()).toBeVisible();await page.screenshot({path:'../work/phase12/'+testInfo.project.name+'-docs.png',fullPage:true})
})
test('unauthenticated protected route and signup verification stay out of the landing page',async({page})=>{
 await fixture(page);await page.goto('/dashboard/schema');await expect(page).toHaveURL(/\/login\?redirect=/)
 await page.route('**/auth/v1/signup',r=>r.fulfill({json:{id:uid,email:'verify@example.invalid',aud:'authenticated',role:'authenticated',identities:[]}}));await page.goto('/signup');await page.waitForFunction(()=>!!(document.querySelector('#__nuxt') as any)?.__vue_app__);await page.getByLabel('Email',{exact:true}).fill('verify@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign up',exact:true}).click();await expect(page.getByText(/Check your email/)).toBeVisible();await expect(page).toHaveURL(/\/signup$/)
})
