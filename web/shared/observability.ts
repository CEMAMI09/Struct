export const RULE_KINDS = [
  'inactivity',
  'never_connected',
  'readings',
  'bytes',
  'packet_size',
  'rejections',
  'delivery_failures',
  'dead_backlog',
  'queue_age',
  'sensor',
  'rollout_failures',
] as const
export type RuleKind = (typeof RULE_KINDS)[number]
export type MetricBucket = Record<string, string> & { bucket: string }
export interface UsageResponse {
  windowComplete:boolean
  coverageStart:string|null
  retentionDays:number
  grain: string
  from: string
  to: string
  updatedAt: string | null
  gaps: string
  pending: string
  buckets: MetricBucket[]
  devices: {
    device_id: string
    name: string
    application: string
    readings: string
  }[]
  groups: { group_id: string; name: string; application: string }[]
  carrier: null
  measurement: string
}
export interface MonitoringDevice {
  observed_rejections:string
  device_alerts:string
  last_monitored_schema_slot: number | null
  id: string
  name: string
  status: string
  mode: 'none' | 'event' | 'scheduled'
  interval_seconds: number
  grace_seconds: number
  last_monitored_commit_at: string | null
  maintenance_until: string | null
  labels: string[]
}
export interface AlertRule {
  last_evaluation_error?:string|null
  id: string
  name: string
  kind: RuleKind
  enabled: boolean
  version: number
  threshold: string
  clear_threshold: string
  severity: string
  last_value: string | null
  last_evaluated_at: string | null
  device_id: string | null
  group_id: string | null
  window_minutes: number
  hold_seconds: number
  cooldown_seconds: number
  email: boolean
  webhook_id: string | null
  comparator: 'gte' | 'lte'
  field: string | null
  tag: string | null
  description: string
}
export interface AlertIncident {
  notification_suppressed_reason?: string | null
  id: string
  rule_id: string
  rule_name: string
  severity: string
  status: string
  value: string
  threshold: string
  reason: string
  opened_at: string
  resolved_at: string | null
}
export interface OverviewResponse {
  devices: MonitoringDevice[]
  total: string
  counts: Record<string, string>
  preferences: {
    default_mode: string
    interval_seconds: number
    grace_seconds: number
    maintenance_until: string | null
    timezone: string
    cost: Record<string, unknown>
  } | null
  groups: { id: string; name: string }[]
  rules: AlertRule[]
  incidents: AlertIncident[]
  activeAlerts: string
  emailPreferences: { enabled: boolean; severity: string } | null
  notifications: {
    id: string
    incident_id: string
    channel: string
    status: string
    attempts: number
    created_at: string
    error_category: string | null
  }[]
  transitions: { incident_id: string; state: string; at: string;notify_pending?:boolean;notification_attempts?:number;notification_error?:string|null }[]
  destinations: { id: string; name: string }[]
  delivery: {
    pending: string
    sending: string
    dead: string
    oldest: string | null
  }
  updatedAt: string
  healthHistory: MetricBucket[]
}
export function counter(v: unknown): bigint {
  if (typeof v !== 'string' || !/^\d{1,40}$/.test(v))
    throw Error('Invalid exact counter')
  return BigInt(v)
}
export function usageTotals(buckets: MetricBucket[]) {
  const fields = [
    'packets',
    'readings',
    'application',
    'receipts',
    'payload',
    'framing',
    'security',
    'unknown',
    'unknown_ip',
    'ip_overhead',
    'duplicates',
    'rejected',
    'delivered',
    'failed_attempts',
    'known',
    'committed_packets',
  ] as const
  const sum = Object.fromEntries(
    fields.map((k) => [
      k,
      buckets.reduce((a, b) => a + counter(b[k] ?? '0'), 0n),
    ]),
  ) as Record<(typeof fields)[number], bigint>
  return {
    ...sum,
    available: buckets.length > 0,
    applicationAvailable: sum.known > 0n,
    networkAvailable:
      buckets.length > 0 && sum.unknown === 0n && sum.unknown_ip === 0n,
    network: sum.application + sum.receipts + sum.ip_overhead,
  }
}
export function formatCount(v: bigint | string): string {
  return BigInt(v).toLocaleString('en-US')
}
export function ratio(n: bigint, d: bigint): string {
  if (d === 0n) return 'Unavailable'
  const v = (n * 100n) / d
  return `${v / 100n}.${(v % 100n).toString().padStart(2, '0')}`
}
export function formatBytes(v: bigint | string): string {
  const n = BigInt(v)
  for (const [suffix, unit] of [
    ['TB', 1000000000000n],
    ['GB', 1000000000n],
    ['MB', 1000000n],
    ['KB', 1000n],
  ] as const)
    if (n >= unit)
      return `${n / unit}.${(((n % unit) * 100n) / unit).toString().padStart(2, '0')} ${suffix}`
  return `${n} B`
}
export interface CostInput {
  pricePerMB: string
  cellularPercent: number
  billingDays: number
  metered: boolean
  monthlyMinimum: string
  allowanceMB: string
  incrementMB: string
  carrierMonthlyBytes: string
  baselineMonthlyBytes: string
  currency: string
}
const decimal = (s: string, scale = 6) => {
  if (!/^\d{1,15}(\.\d{1,6})?$/.test(s))
    throw Error('Enter a nonnegative decimal (up to 6 decimal places)')
  const [a, b = ''] = s.split('.')
  return BigInt(a!) * 10n ** BigInt(scale) + BigInt(b.padEnd(scale, '0'))
}
export interface CostResult {
  available: boolean
  reason?: string
  error?: string
  monthlyBytes?: string
  annualBytes?: string
  monthlyCost?: string
  annualCost?: string
  difference?: string | null
  differenceLabel?: string
  source?: string
  note?: string
}
export function estimateCost(
  networkBytes: bigint | null,
  windowSeconds: number,
  input: CostInput,
): CostResult {
  if (
    !Number.isInteger(input.billingDays) ||
    input.billingDays < 1 ||
    input.billingDays > 366 ||
    !Number.isFinite(windowSeconds) ||
    windowSeconds < 1 ||
    !Number.isInteger(input.cellularPercent) ||
    input.cellularPercent < 0 ||
    input.cellularPercent > 100
  )
    throw Error('Invalid billing period or cellular fraction')
  const periodSeconds = BigInt(input.billingDays * 86400),
    fraction = BigInt(input.cellularPercent),
    price = decimal(input.pricePerMB),
    minimum = decimal(input.monthlyMinimum) * 1000000n,
    allowanceBytes = decimal(input.allowanceMB),
    incrementBytes = decimal(input.incrementMB)
  const monthly = input.carrierMonthlyBytes
    ? counter(input.carrierMonthlyBytes)
    : networkBytes === null
      ? null
      : (((networkBytes * periodSeconds) / BigInt(Math.round(windowSeconds))) *
          fraction) /
        100n
  if (monthly === null)
    return {
      available: false,
      reason:
        'A sufficiently covered recorded-traffic window or an explicit carrier measurement is required.',
    }
  const charge = (bytes: bigint) => {
    if (!input.metered) return minimum
    let billable = bytes > allowanceBytes ? bytes - allowanceBytes : 0n
    if (incrementBytes > 0n)
      billable =
        ((billable + incrementBytes - 1n) / incrementBytes) * incrementBytes
    const amount = billable * price
    return amount > minimum ? amount : minimum
  }
  const cost = charge(monthly),
    baseline = input.baselineMonthlyBytes
      ? counter(input.baselineMonthlyBytes)
      : null,
    savings =
      baseline !== null && input.metered ? charge(baseline) - cost : null
  const money = (v: bigint) => {
    const a = v < 0n ? -v : v,
      f = (a % 1000000000000n)
        .toString()
        .padStart(12, '0')
        .replace(/0+$/, '')
        .padEnd(2, '0')
    return `${v < 0n ? '-' : ''}${a / 1000000000000n}.${f}`
  }
  return {
    available: true,
    monthlyBytes: monthly.toString(),
    annualBytes: ((monthly * 365n) / BigInt(input.billingDays)).toString(),
    monthlyCost: money(cost),
    annualCost: money((cost * 365n) / BigInt(input.billingDays)),
    difference:
      savings === null ? null : money(savings < 0n ? -savings : savings),
    differenceLabel:
      savings === null
        ? 'Savings unavailable'
        : savings < 0n
          ? 'Additional estimated cost'
          : savings === 0n
            ? 'No estimated cost difference'
            : 'Potential estimated savings',
    source: input.carrierMonthlyBytes
      ? 'User-provided carrier bytes; cellular fraction is already included'
      : 'Modeled projection from recorded UDP/IP minimums with customer cellular fraction; assumes the window is representative and omits unobserved traffic',
    note: input.metered
      ? 'Decimal MB; fleet-level allowance, minimum and rounding. Does not model per-device carrier session billing.'
      : 'Flat-rate bill does not automatically fall when traffic decreases; savings unavailable.',
  }
}
export const defaultCost: CostInput = {
  pricePerMB: '',
  cellularPercent: 100,
  billingDays: 30,
  metered: true,
  monthlyMinimum: '0',
  allowanceMB: '0',
  incrementMB: '0',
  carrierMonthlyBytes: '',
  baselineMonthlyBytes: '',
  currency: 'USD',
}
