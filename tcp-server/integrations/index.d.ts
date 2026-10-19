export type IntegrationKind =
  | 'http'
  | 'aws_sqs'
  | 'aws_eventbridge'
  | 'azure_service_bus'
  | 'google_pubsub'
  | 'postgresql'
export interface Route {
  all?: Route[]
  any?: Route[]
  field?: string
  op?: string
  value?: string | number | boolean
}
export interface Mapping {
  format: 'envelope-v1' | 'flat-v1'
  fields: {
    from: string
    to: string
    convert?: 'identity' | 'string' | 'boolean'
    required?: boolean
  }[]
  metadata: string[]
}
export interface Snapshot {
  kind: IntegrationKind
  config: Record<string, unknown>
  mapping: Mapping
  schema_slot?: number
  schema_version?: number
}
export const kinds: IntegrationKind[]
export function validateConfig(
  kind: IntegrationKind,
  input: unknown,
): Record<string, unknown>
export function validateCredentials(
  kind: IntegrationKind,
  input: unknown,
): Record<string, unknown>
export function validateRoute(input: unknown): Route | null
export function validateMapping(input: unknown): Mapping
export function seal(
  value: unknown,
  organizationId: string,
  destinationId: string,
): string
export function open(
  blob: string,
  organizationId: string,
  destinationId: string,
): Record<string, unknown>
export function transform(
  body: Record<string, unknown>,
  snapshot: Snapshot,
): { value: Record<string, unknown>; serialized: string }
export function execute(
  snapshot: Snapshot,
  secrets: unknown,
  body: Record<string, unknown>,
  job: Record<string, unknown>,
  options?: { mode?: string; dependencies?: Record<string, unknown> },
): Promise<{
  outcome?: string
  category?: string
  detail: string
  level?: string
  providerReceipt?: string
  httpStatus?: number
}>

export const capabilities: Record<
  IntegrationKind,
  {
    transport: string
    authentication: string
    verification: string
    acceptance: string
    nativeBatching: boolean
  }
>
export function getAdapter(kind: IntegrationKind): {
  kind: IntegrationKind
  capabilities: (typeof capabilities)[IntegrationKind]
  validateConfiguration: (input: unknown) => Record<string, unknown>
  validateCredentials: (input: unknown) => Record<string, unknown>
  verify: (
    snapshot: Snapshot,
    secrets: unknown,
    options?: { dependencies?: Record<string, unknown> },
  ) => ReturnType<typeof execute>
  deliver: typeof execute
}
