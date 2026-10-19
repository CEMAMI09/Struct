import { describe, it, expect } from 'vitest'
import {
  deliveryLabel,
  formatDeliveryTime,
  eventTimeline,
  parseDeliveryRecords,
  recoveryError,
  type EventDetail,
} from './delivery'
describe('delivery evidence and recovery presentation', () => {
  it('separates queue, attempts and terminal state', () => {
    expect(deliveryLabel('pending', 0)).toBe('Queued')
    expect(deliveryLabel('pending', 2)).toBe('Retrying')
    expect(deliveryLabel('dead')).toContain('dead letter')
    expect(deliveryLabel('skipped', 0, 'manual_cancel')).toBe('Canceled')
  })
  it('never renders an invalid timestamp', () => {
    expect(formatDeliveryTime('not a date')).toBe('Unavailable')
    expect(formatDeliveryTime(null)).toBe('—')
  })
  it('uses observed attempt timestamps, not future retry time as completed evidence', () => {
    const detail: EventDetail = {
      event: {
        id: 'event',
        device_id: 'device',
        device_name: 'Sensor',
        accepted_at: '2026-01-01T00:00:00Z',
        sample_at: '2026-01-01T00:00:00Z',
        protocol: 'secure-v2',
        wire_device_id: 1,
        sequence: 1,
        record_index: 0,
        schema_slot: 0,
      },
      deliveries: [],
      actions: [],
      traces: [],
      attempts: [
        {
          id: 1,
          delivery_id: 'delivery',
          attempt_number: 1,
          attempted_at: '2026-01-01T00:00:01Z',
          completed_at: '2026-01-01T00:00:02Z',
          outcome: 'retry',
          detail: 'HTTP 503',
          next_retry_at: '2026-01-01T00:00:10Z',
          http_status: 503,
          error_category: 'http_transient',
          latency_ms: 1000,
        },
      ],
    }
    const timeline = eventTimeline(detail)
    expect(timeline[0]?.label).toBe('Stored')
    expect(timeline.at(-1)?.label).toBe('Retry scheduled')
    expect(timeline.at(-1)?.at).toBe('2026-01-01T00:00:02Z')
    expect(
      timeline.some((x) => x.label.toLowerCase().includes('authenticated')),
    ).toBe(false)
  })
  it('does not invent historical event metadata', () => {
    expect(
      eventTimeline({
        event: null,
        deliveries: [],
        attempts: [],
        actions: [],
        traces: [],
      }),
    ).toEqual([])
  })
  it('rejects malformed results instead of substituting zero', () => {
    expect(() => parseDeliveryRecords(null)).toThrow()
    expect(() =>
      parseDeliveryRecords([{ id: 'x', event_id: 'y', status: 'invented' }]),
    ).toThrow()
  })
  it('maps known failures without echoing secret-bearing raw errors', () => {
    expect(recoveryError({ message: 'PAYLOAD_EXPIRED' })).toContain('expired')
    expect(recoveryError({ message: 'secret=abcdef' })).not.toContain('abcdef')
  })
})
