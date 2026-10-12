export type DeviceActivity = 'Active' | 'Inactive' | 'Never connected' | 'Disabled'
export function deviceActivity(device: {last_seen?: string|null; first_telemetry_at?:string|null; expected_report_interval_ms?:number|null; disabled?:boolean}, now=Date.now()):DeviceActivity {
  if(device.disabled)return 'Disabled'
  const seen=Date.parse(device.last_seen||'')
  // A backfilled first-reading milestone may record recognition time, not activity time.
  if(!Number.isFinite(seen))return device.first_telemetry_at?'Inactive':'Never connected'
  const interval=device.expected_report_interval_ms
  const threshold=interval && interval>=1000 ? Math.max(90000,interval*3) : 300000
  return now-seen<=threshold ? 'Active':'Inactive'
}
export const ACTIVITY_HELP='Activity describes recent observations, not a live connection or proof of stored telemetry. Active means activity within 3 expected reporting intervals (at least 90 seconds), or 5 minutes when no interval is configured.'
