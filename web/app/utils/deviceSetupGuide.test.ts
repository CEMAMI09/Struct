import {it,expect} from 'vitest'
import {shouldShowDeviceSetupGuide as show} from './deviceSetupGuide'
it('requires loaded durable workspace state and never infers completion from retained data',()=>{
 expect(show({loaded:false,firstPacketAt:null,dismissedAt:null})).toBe(false)
 expect(show({loaded:true,firstPacketAt:null,dismissedAt:null})).toBe(true)
 expect(show({loaded:true,firstPacketAt:'2026-01-01',dismissedAt:null})).toBe(false)
 expect(show({loaded:true,firstPacketAt:null,dismissedAt:'2026-01-01'})).toBe(false)
 expect(show({loaded:true,firstPacketAt:'2026-01-01',dismissedAt:null,reopened:true})).toBe(true)
})
