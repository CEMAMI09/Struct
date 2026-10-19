import { describe, it, expect } from 'vitest'
import {
  counter,
  formatBytes,
  usageTotals,
  estimateCost,
  defaultCost,
} from './observability'
describe('exact usage and explicit cost models', () => {
  it('preserves counters beyond JavaScript exact integers', () => {
    expect(counter('9007199254740993')).toBe(9007199254740993n)
    expect(() => counter(9007199254740993)).toThrow()
    expect(formatBytes(1500n)).toBe('1.50 KB')
  })
  it('does not invent empty traffic or complete network observations', () => {
    expect(usageTotals([]).available).toBe(false)
    const t = usageTotals([
      {
        bucket: '2026-01-01',
        application: '34',
        receipts: '21',
        ip_overhead: '56',
        unknown_ip: '0',
        unknown: '0',
        readings: '1',
      },
    ])
    expect(t.network).toBe(111n)
    expect(t.networkAvailable).toBe(true)
    expect(usageTotals([{ bucket: 'x', unknown: '1' }]).networkAvailable).toBe(
      false,
    )
  })
  const input = () => ({
    ...defaultCost,
    pricePerMB: '1',
    cellularPercent: 50,
    baselineMonthlyBytes: '2000000',
  })
  it('applies cellular fraction once and decimal MB pricing', () => {
    const r = estimateCost(2000000n, 30 * 86400, input())
    expect(r.monthlyBytes).toBe('1000000')
    expect(r.monthlyCost).toBe('1.00')
    expect(r.difference).toBe('1.00')
  })
  it('uses carrier override as already-cellular traffic', () => {
    const r = estimateCost(null, 86400, {
      ...input(),
      carrierMonthlyBytes: '1000000',
    })
    expect(r.monthlyCost).toBe('1.00')
  })
  it('does not fabricate baseline or flat-rate savings', () => {
    expect(
      estimateCost(1000000n, 30 * 86400, {
        ...input(),
        baselineMonthlyBytes: '',
      }).difference,
    ).toBe(null)
    const r = estimateCost(1000000n, 30 * 86400, {
      ...input(),
      metered: false,
      monthlyMinimum: '12',
    })
    expect(r.monthlyCost).toBe('12.00')
    expect(r.difference).toBe(null)
  })
  it('labels additional costs, zero difference, allowance and minimum', () => {
    expect(estimateCost(6000000n, 30 * 86400, input()).differenceLabel).toBe(
      'Additional estimated cost',
    )
    expect(estimateCost(4000000n, 30 * 86400, input()).differenceLabel).toBe(
      'No estimated cost difference',
    )
    expect(
      estimateCost(4000000n, 30 * 86400, {
        ...input(),
        allowanceMB: '1',
        incrementMB: '2',
        monthlyMinimum: '3',
      }).monthlyCost,
    ).toBe('3.00')
  })
  it('requires explicit pricing and adequate measurement', () => {
    expect(() => estimateCost(1n, 86400, defaultCost)).toThrow()
    expect(estimateCost(null, 86400, input()).available).toBe(false)
    expect(() => estimateCost(1n, 0, input())).toThrow()
    expect(() =>
      estimateCost(1n, 86400, { ...input(), cellularPercent: 101 }),
    ).toThrow()
  })
  it('scales annual usage by billing period without floating counters', () => {
    expect(
      estimateCost(1000000n, 86400, { ...input(), cellularPercent: 100 })
        .annualBytes,
    ).toBe('365000000')
  })
  it('does not round nonzero sub-cent estimates to a false zero', () => {
    expect(
      estimateCost(1n, 30 * 86400, { ...input(), cellularPercent: 100 })
        .monthlyCost,
    ).toBe('0.000001')
  })
})
