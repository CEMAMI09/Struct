import {shouldShowDeviceSetupGuide} from '~/utils/deviceSetupGuide'
import type {Database} from '~/types/database.types'
interface OnboardingState { first_packet_at:string|null; dismissed_at:string|null;schema_device_ids?:string[] }
const controls=new WeakMap<object,{pending:Promise<void>|null;org:string|null;generation:number}>()
export function useOnboarding(){
 const app=useNuxtApp();if(!controls.has(app))controls.set(app,{pending:null,org:null,generation:0});const control=controls.get(app)!
 const client=useSupabaseClient<Database>(),{currentOrgId,canWrite}=useOrganization()
 const state=useState<OnboardingState|null>('onboarding',()=>null),loadedOrg=useState<string|null>('onboarding-org',()=>null),error=useState('onboarding-error',()=>''),reopened=useState('onboarding-reopened',()=>false)
 const current=computed(()=>loadedOrg.value===currentOrgId.value?state.value:null)
 const show=computed(()=>shouldShowDeviceSetupGuide({loaded:!!current.value,firstPacketAt:current.value?.first_packet_at??null,dismissedAt:current.value?.dismissed_at??null,reopened:reopened.value}))
 async function refresh(){
  const org=currentOrgId.value;if(!org)return
  if(control.pending&&control.org===org)return control.pending
  const run=++control.generation;control.org=org;error.value=''
  if(loadedOrg.value!==org){state.value=null;reopened.value=false}
  const pending=(async()=>{const result=await client.rpc('workspace_onboarding',{p_org_id:org});if(run!==control.generation||org!==currentOrgId.value)return
   if(result.error){error.value='Getting Started progress could not be loaded. Refresh or open the setup guide.';return}
   const data=result.data
   if(!data||typeof data!=='object'||Array.isArray(data)||!('first_packet_at' in data)||!('dismissed_at' in data)){error.value='Getting Started returned invalid progress.';return}
   const first=data.first_packet_at,dismissed=data.dismissed_at
   if((first!==null&&typeof first!=='string')||(dismissed!==null&&typeof dismissed!=='string')){error.value='Getting Started returned invalid progress.';return}
   state.value={first_packet_at:first,dismissed_at:dismissed,schema_device_ids:Array.isArray(data.schema_device_ids)?data.schema_device_ids.filter((id):id is string=>typeof id==='string'):[]};loadedOrg.value=org
  })().catch(()=>{if(run===control.generation)error.value='Getting Started progress could not be loaded.'}).finally(()=>{if(control.pending===pending)control.pending=null})
  control.pending=pending;return pending
 }
 async function dismiss(){if(!canWrite.value)return;const org=currentOrgId.value;const {error:err}=await client.rpc('dismiss_workspace_onboarding',{p_org_id:org!});if(err)throw new Error('Unable to save dismissal. Please try again.');if(org===currentOrgId.value){await refresh();reopened.value=false}}
 async function markDevice(id:string,step:'downloaded'|'configured'|'interval',interval:number|null=null){const {error:err}=await client.rpc('update_device_setup',{p_device_id:id,p_step:step,p_interval_ms:interval});if(err)throw new Error(err.message)}
 return {state:current,show,error,reopened,refresh,dismiss,markDevice}
}
