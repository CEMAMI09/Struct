/** Limits are supplied by current entitlements, never an independent UI plan table. */
export const BILLING_SETTINGS_PATH='/dashboard/settings?tab=billing'
export function deviceAllowanceMessage(usage:number,limit:number,projected?:number){
 return `Device allowance reached: ${usage} of ${limit} devices in use${projected===undefined?'':`; this action would reach ${projected}`}. Review Billing to add capacity or remove an unused device.`
}
