export type IntegrationKind =
  | 'http'
  | 'aws_sqs'
  | 'aws_eventbridge'
  | 'azure_service_bus'
  | 'google_pubsub'
  | 'postgresql'
export interface Integration {
  destination_id: string
  organization_id: string
  kind: IntegrationKind
  version: number
  config: Record<string, unknown>
  route: unknown
  mapping: unknown
  updated_at: string
  last_check: { level?: string; detail?: string; outcome?: string } | null
  last_checked_at: string | null
  destination: { name: string; enabled: boolean; paused_at: string | null }
}
export const INTEGRATION_CATALOG: {
  kind: IntegrationKind
  title: string
  group: string
  description: string
  fields: { key: string; label: string; example: string }[]
  secrets: {
    key: string
    label: string
    optional?: boolean
    multiline?: boolean
  }[]
}[] = [
  {
    kind: 'http',
    title: 'HTTP / Webhook',
    group: 'Applications',
    description: 'Signed HTTPS JSON to your application.',
    fields: [
      {
        key: 'url',
        label: 'HTTPS endpoint',
        example: 'https://api.example.com/telemetry',
      },
    ],
    secrets: [
      { key: 'signingSecret', label: 'HMAC signing secret' },
      { key: 'bearerToken', label: 'Bearer token', optional: true },
    ],
  },
  {
    kind: 'aws_sqs',
    title: 'AWS SQS',
    group: 'AWS',
    description: 'Standard and FIFO queue publication.',
    fields: [
      { key: 'region', label: 'AWS region', example: 'us-east-1' },
      {
        key: 'queueUrl',
        label: 'Queue URL',
        example: 'https://sqs.us-east-1.amazonaws.com/123456789012/telemetry',
      },
      {
        key: 'messageGroup',
        label: 'FIFO group (device or fixed name)',
        example: 'device',
      },
    ],
    secrets: [
      { key: 'accessKeyId', label: 'Access key ID' },
      { key: 'secretAccessKey', label: 'Secret access key' },
      { key: 'sessionToken', label: 'Session token', optional: true },
    ],
  },
  {
    kind: 'aws_eventbridge',
    title: 'AWS EventBridge',
    group: 'AWS',
    description: 'Publish entries to your existing event bus.',
    fields: [
      { key: 'region', label: 'AWS region', example: 'us-east-1' },
      { key: 'eventBus', label: 'Event bus name', example: 'telemetry' },
      { key: 'source', label: 'Event source', example: 'struct.telemetry' },
      { key: 'detailType', label: 'Detail type', example: 'Telemetry' },
    ],
    secrets: [
      { key: 'accessKeyId', label: 'Access key ID' },
      { key: 'secretAccessKey', label: 'Secret access key' },
      { key: 'sessionToken', label: 'Session token', optional: true },
    ],
  },
  {
    kind: 'azure_service_bus',
    title: 'Azure Service Bus',
    group: 'Azure',
    description: 'Send to an existing queue or topic over HTTPS.',
    fields: [
      {
        key: 'namespace',
        label: 'Namespace (without domain)',
        example: 'company-events',
      },
      { key: 'entity', label: 'Queue or topic name', example: 'telemetry' },
    ],
    secrets: [
      { key: 'keyName', label: 'Send-only SAS policy name' },
      { key: 'key', label: 'SAS policy key' },
    ],
  },
  {
    kind: 'google_pubsub',
    title: 'Google Cloud Pub/Sub',
    group: 'Google Cloud',
    description: 'Publish JSON with stable event attributes.',
    fields: [
      { key: 'project', label: 'Project ID', example: 'company-telemetry' },
      { key: 'topic', label: 'Topic ID', example: 'telemetry' },
    ],
    secrets: [
      { key: 'clientEmail', label: 'Service account email' },
      {
        key: 'privateKey',
        label: 'Service account PEM private key',
        multiline: true,
      },
    ],
  },
  {
    kind: 'postgresql',
    title: 'PostgreSQL',
    group: 'Databases',
    description: 'TLS-verified, parameterized, idempotent inserts.',
    fields: [
      { key: 'host', label: 'Public database host', example: 'db.example.com' },
      { key: 'port', label: 'Port', example: '5432' },
      { key: 'database', label: 'Database', example: 'telemetry' },
      { key: 'schema', label: 'Schema', example: 'public' },
      { key: 'table', label: 'Existing table', example: 'struct_events' },
    ],
    secrets: [
      { key: 'user', label: 'Database user' },
      { key: 'password', label: 'Database password' },
      {
        key: 'ca',
        label: 'Custom CA certificate (optional)',
        optional: true,
        multiline: true,
      },
    ],
  },
]
export const DEFAULT_MAPPING = {
  format: 'envelope-v1',
  fields: [],
  metadata: ['device_id', 'timestamp', 'schema'],
}
