import catalog from '../../protocol/enterprise-permissions.json'
export type EnterpriseRole = keyof typeof catalog
export const ROLE_PERMISSIONS = catalog
export function hasPermission(
  role: string | null | undefined,
  capability: string,
): boolean {
  return (
    !!role &&
    Object.prototype.hasOwnProperty.call(catalog, role) &&
    (catalog[role as EnterpriseRole] as readonly string[]).includes(capability)
  )
}
export const ROLE_DESCRIPTIONS = {
  owner: 'Full workspace control, ownership and billing.',
  admin:
    'Team and resource administration; cannot grant administrator or owner roles.',
  developer:
    'Devices, schemas, permitted integrations and operational recovery. Individual SDK credentials are permitted; bulk credential exports and billing are restricted.',
  operator:
    'Read operations, retry eligible failed deliveries and acknowledge alerts. No device credentials or configuration changes.',
  viewer:
    'Read dashboards and permitted workspace resources; no operational mutations.',
}
