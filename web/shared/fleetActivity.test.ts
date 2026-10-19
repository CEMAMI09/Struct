import { it, expect } from 'vitest'
import { deviceActivity } from './deviceActivity'
it('uses lifecycle before activity and the same five-minute minimum as inventory SQL', () => {
  const now = Date.parse('2026-10-12T12:00:00Z'),
    last_seen = '2026-10-12T11:57:00Z'
  expect(
    deviceActivity({ last_seen, expected_report_interval_ms: 1000 }, now),
  ).toBe('Active')
  expect(deviceActivity({ last_seen, lifecycle: 'disabled' }, now)).toBe(
    'Disabled',
  )
  expect(deviceActivity({ last_seen, lifecycle: 'revoked' }, now)).toBe(
    'Revoked',
  )
  expect(deviceActivity({ last_seen, lifecycle: 'deleted' }, now)).toBe(
    'Archived',
  )
  expect(
    deviceActivity(
      { last_seen: '2026-10-12T11:54:59Z', expected_report_interval_ms: 1000 },
      now,
    ),
  ).toBe('Inactive')
})
