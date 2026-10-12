import {describe,it,expect} from 'vitest'
import {deviceAllowanceMessage} from './limitFeedback'
import {deviceActivity} from './deviceActivity'
import {GUIDES,guideBySlug} from './documentation'
import {safeAuthDestination} from '../app/utils/postAuthRedirect'
describe('Phase 1/2 user-facing rules',()=>{
 it('uses durable history, explicit intervals and consistent activity statuses',()=>{const now=Date.parse('2026-10-11T12:00:00Z');expect(deviceActivity({},now)).toBe('Never connected');expect(deviceActivity({last_seen:'2026-10-11T11:59:00Z'},now)).toBe('Active');expect(deviceActivity({first_telemetry_at:'2026-01-01'},now)).toBe('Inactive');expect(deviceActivity({first_telemetry_at:new Date(now).toISOString()},now)).toBe('Inactive');expect(deviceActivity({last_seen:'2026-10-11T11:50:00Z',expected_report_interval_ms:600000},now)).toBe('Active');expect(deviceActivity({disabled:true},now)).toBe('Disabled')})
 it('uses real allowance inputs for free, paid and over-limit feedback',()=>{expect(deviceAllowanceMessage(5,5,6)).toContain('5 of 5');expect(deviceAllowanceMessage(155,155,156)).toContain('155 of 155');expect(deviceAllowanceMessage(200,155)).toContain('remove an unused device')})
 it('only preserves safe dashboard destinations',()=>{expect(safeAuthDestination('/dashboard/schema?device=a')).toBe('/dashboard/schema?device=a');for(const value of ['https://evil.invalid','//evil.invalid','/dashboard/../../evil','/dashboard/\\evil','/login',undefined,'javascript:alert(1)'])expect(safeAuthDestination(value)).toBe('/dashboard')})
 it('publishes resolvable, unique task guides and exact commands',()=>{expect(new Set(GUIDES.map(g=>g.slug)).size).toBe(GUIDES.length);for(const g of GUIDES){expect(guideBySlug(g.slug)).toBe(g);expect(g.sections.length).toBeGreaterThan(0)}expect(guideBySlug('missing')).toBeUndefined();const first=guideBySlug('getting-started')!;expect(first.sections.some(s=>s.code?.includes('node send.cjs'))).toBe(true);expect(first.sections.some(s=>s.code?.includes('pio run -t upload'))).toBe(true)})
})
