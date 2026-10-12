import {it,expect,vi,afterEach} from 'vitest'
import {ref} from 'vue'
import {useBilling} from './useBilling'
afterEach(()=>vi.unstubAllGlobals())
it('deduplicates refresh, clears stale errors and ignores a previous workspace response',async()=>{
 const states=new Map(),app={},org=ref('a');let resolve!:(v:any)=>void;const fetch=vi.fn(()=>new Promise(r=>resolve=r)),members=vi.fn(),usage=vi.fn()
 vi.stubGlobal('useNuxtApp',()=>app);vi.stubGlobal('useState',(key:string,init:()=>unknown)=>{if(!states.has(key))states.set(key,ref(init()));return states.get(key)});vi.stubGlobal('useOrganization',()=>({currentOrgId:org,requireWrite:()=>{},fetchMemberships:members,fetchUsageStats:usage}));vi.stubGlobal('$fetch',fetch)
 const api=useBilling();api.error.value='Stale error';const first=api.syncFromStripe(),second=api.syncFromStripe();expect(fetch).toHaveBeenCalledTimes(1);expect(api.error.value).toBeNull();expect(api.syncing.value).toBe(true);resolve({ok:true,synced:false,subscriptionTier:'free'});expect(await first).toMatchObject({subscriptionTier:'free'});await second;expect(api.syncing.value).toBe(false);expect(members).toHaveBeenCalledTimes(1)
 const stale=api.syncFromStripe();org.value='b';resolve({ok:true,synced:true,subscriptionTier:'pro'});expect(await stale).toBeNull();expect(members).toHaveBeenCalledTimes(1)
})
