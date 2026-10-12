import {it,expect,vi,afterEach} from 'vitest'
import {ref,computed} from 'vue'
import {useOnboarding} from './useOnboarding'
afterEach(()=>vi.unstubAllGlobals())
it('persists completion independently of current rows and rejects late workspace responses',async()=>{
 const state=new Map(),org=ref('a'),app={},queue:Array<(v:any)=>void>=[]
 vi.stubGlobal('useNuxtApp',()=>app);vi.stubGlobal('computed',computed);vi.stubGlobal('useState',(key:string,init:()=>unknown)=>{if(!state.has(key))state.set(key,ref(init()));return state.get(key)})
 vi.stubGlobal('useOrganization',()=>({currentOrgId:org,canWrite:ref(true)}));vi.stubGlobal('useSupabaseClient',()=>({rpc:()=>new Promise(resolve=>queue.push(resolve))}))
 const api=useOnboarding(),a=api.refresh();org.value='b';const b=api.refresh();queue[1]!({data:{first_packet_at:'2026-01-01',dismissed_at:null},error:null});await b;queue[0]!({data:{first_packet_at:null,dismissed_at:null},error:null});await a
 expect(api.state.value?.first_packet_at).toBe('2026-01-01');expect(api.show.value).toBe(false);api.reopened.value=true;expect(api.show.value).toBe(true);org.value='c';expect(api.state.value).toBeNull();expect(api.show.value).toBe(false)
})
