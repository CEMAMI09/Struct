import type { Json } from '~/types/database.types'
export type DeliveryStatus =
  | 'pending'
  | 'sending'
  | 'delivered'
  | 'dead'
  | 'skipped'
export interface DeliveryRecord {
  integration_snapshot?: {
    kind: string
    version: number
    mapping_version?: number
    route: unknown
    mapping: unknown
    schema_slot?: number
    schema_version?: number
  } | null
  id: string
  event_id: string
  device_id: string | null
  device_name: string | null
  destination_id: string | null
  status: DeliveryStatus
  attempts: number
  total_attempts: number
  replay_count: number
  created_at: string
  updated_at: string
  last_attempt_at: string | null
  next_attempt_at: string
  delivered_at: string | null
  last_error: string | null
  error_category: string | null
  http_status: number | null
  terminal_reason: string | null
  payload_expires_at: string
  payload_available: boolean
  protocol: string | null
  schema_slot: number | null
  sequence: number | null
  record_index: number | null
  accepted_at: string | null
}
export interface DestinationHealth {
  id: string
  name: string
  enabled: boolean
  paused_at: string | null
  backlog: number
  last_success: string | null
  dead: number
  failures_24h: number
  attempts_24h: number
}
export interface DeliveryOverview {
  counts: Partial<Record<DeliveryStatus, number>>
  oldest_pending: string | null
  destinations: DestinationHealth[]
}
export interface DeliveryAttempt {
  provider_receipt?: string | null
  id: number
  delivery_id: string
  attempt_number: number | null
  attempted_at: string
  completed_at: string | null
  outcome: string
  detail: string | null
  http_status: number | null
  error_category: string | null
  latency_ms: number | null
  next_retry_at: string | null
}
export interface EventDetail {
  event: {
    id: string
    device_id: string | null
    device_name: string | null
    accepted_at: string
    sample_at: string
    protocol: string
    wire_device_id: number | null
    sequence: number | null
    record_index: number | null
    schema_slot: number | null
  } | null
  deliveries: DeliveryRecord[]
  attempts: DeliveryAttempt[]
  actions: { id: string; action: string; created_at: string }[]
  traces: Json[]
}
export function deliveryLabel(
  status: string,
  attempts = 0,
  terminal?: string | null,
) {
  if (status === 'pending') return attempts ? 'Retrying' : 'Queued'
  if (status === 'dead') return 'Failed · dead letter'
  if (status === 'sending') return 'Sending'
  if (status === 'skipped')
    return terminal === 'manual_cancel' ? 'Canceled' : 'Skipped'
  if (status === 'delivered') return 'Delivered'
  return 'Unknown'
}
export function deliveryTone(status: string) {
  return status === 'delivered'
    ? 'ok'
    : status === 'dead'
      ? 'bad'
      : status === 'sending'
        ? 'warn'
        : 'info'
}
export function formatDeliveryTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], { timeZoneName: 'short' })
    : 'Unavailable'
}
export function recoveryError(error: unknown) {
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : ''
  const known: Record<string, string> = {
    PAYLOAD_EXPIRED:
      'The recovery payload has expired. The original event cannot be sent again.',
    REPLAY_LIMIT: 'This delivery has reached its three manual recovery cycles.',
    RECOVERY_RATE_LIMIT: 'Too many recovery actions. Try again in a minute.',
    BULK_CONFIRMATION_REQUIRED: 'Preview and confirm this bulk action first.',
    REQUEST_ID_CONFLICT:
      'This request identifier was already used for a different action.',
  }
  return (
    Object.entries(known).find(([code]) => message.includes(code))?.[1] ||
    'Unable to complete the delivery operation. Check your permissions and the destination, then refresh.'
  )
}
export function parseDeliveryRecords(value: unknown): DeliveryRecord[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (x) =>
        !x ||
        typeof x.id !== 'string' ||
        typeof x.event_id !== 'string' ||
        !['pending', 'sending', 'delivered', 'dead', 'skipped'].includes(
          x.status,
        ),
    )
  )
    throw new Error('Invalid delivery response')
  return value as DeliveryRecord[]
}
export interface TimelineEntry {
  key: string
  at: string
  label: string
  detail?: string | null
}
export function eventTimeline(detail: EventDetail): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  if (detail.event)
    entries.push({
      key: 'accepted',
      at: detail.event.accepted_at,
      label: 'Stored',
      detail:
        'Telemetry accepted in the database transaction. This timestamp is recorded by PostgreSQL; it is not packet arrival time.',
    })
  for (const job of detail.deliveries) {
    entries.push({
      key: `queued-${job.id}`,
      at: job.created_at,
      label: 'Delivery queued',
      detail: `Delivery ${job.id}`,
    })
    if (job.delivered_at)
      entries.push({
        key: `delivered-${job.id}`,
        at: job.delivered_at,
        label: 'Delivered',
        detail:
          'Receiver returned HTTP 2xx; this does not prove its later business processing.',
      })
  }
  for (const attempt of detail.attempts) {
    entries.push({
      key: `attempt-${attempt.id}`,
      at: attempt.attempted_at,
      label: `Attempt ${attempt.attempt_number ?? 'historical'}`,
      detail:
        attempt.outcome === 'dispatching'
          ? 'Claimed by worker; request completion not yet recorded'
          : `Delivery ${attempt.delivery_id}`,
    })
    if (attempt.completed_at)
      entries.push({
        key: `completed-${attempt.id}`,
        at: attempt.completed_at,
        label: attempt.outcome,
        detail: attempt.detail,
      })
    if (attempt.next_retry_at)
      entries.push({
        key: `retry-${attempt.id}`,
        at: attempt.completed_at || attempt.attempted_at,
        label: 'Retry scheduled',
        detail: `Planned for ${formatDeliveryTime(attempt.next_retry_at)}; this is scheduling evidence, not a completed request.`,
      })
  }
  for (const action of detail.actions)
    entries.push({
      key: action.id,
      at: action.created_at,
      label: `Manual ${action.action}`,
    })
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
