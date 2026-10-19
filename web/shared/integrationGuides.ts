import type { Guide } from './documentation'
export const INTEGRATION_GUIDES: Guide[] = [
  {
    slug: 'integrations',
    title: 'Bring your own backend',
    summary:
      'Route securely ingested readings to cloud services, PostgreSQL or HTTPS applications.',
    sections: [
      {
        title: 'Availability and setup',
        paragraphs: [
          'Integrations require an activated Phase 7 deployment. Open Dashboard → Integrations, choose a destination, enter connection settings and scoped credentials, choose routing and field mapping, review, and save. New connections are disabled. Verify the connection, then explicitly enable forwarding. Existing Webhooks retain their original JSON and HMAC contract.',
          'Connection checks report configuration valid, credentials verified or connection established. These are separate from successful publication. A send-only credential may not support read-only lookup; use the clearly confirmed test-send action to publish one synthetic event. No customer telemetry is sent by a basic check. The generic synthetic test contains test=true and a message; a required field mapping may reject it. Use the no-send sample preview to validate mappings, then confirm real delivery through the Delivery history after enabling.',
        ],
      },
      {
        title: 'Routing rules',
        paragraphs: [
          'All telemetry is the default. Conditional rules retain the existing Scale entitlement. Use payload.temperature, device_id, schema_slot, schema_version or event_type with eq, ne, gt, gte, lt, lte, contains or exists. AND/OR groups support up to five levels and 64 conditions. Missing or invalid fields fail closed. Quote text and exact large integers in JSON. Numeric thresholds compare decimal values in PostgreSQL without JavaScript integer coercion.',
          'Each destination has one expression, which can contain several nested groups. Every matched event creates at most one delivery per destination. Rule priority and independent named rule objects are not implemented. Schema identity currently means device plus immutable Secure V2 slot (and linked legacy schema version when available), not a shared cross-device schema catalog.',
          'Routing and configuration are snapshotted in the ingestion transaction. Editing a rule affects new events, not existing queued work. Pausing retains work and stops new claims; packets can still add matching jobs. Disabling stops new routing and can make queued attempts terminal. In-flight requests may finish. Downgrading a workspace with a conditional integration stops its new routing; it does not broadcast formerly filtered data.',
        ],
      },
      {
        title: 'Field mapping and precision',
        paragraphs: [
          'Choose an envelope with a data object or a flat object. Select source fields and destination names to include only those fields. With no mappings, all fields are retained. Optional metadata includes device ID, timestamp and schema slot/version; event_id, event_type and format_version are mandatory. Identity, scalar-to-string and explicit boolean conversions are supported. Numeric narrowing and arbitrary code are not. Missing required fields and metadata-name conflicts fail visibly.',
          'Float64 uses its JSON round-trip representation. Integers beyond JavaScript safe range remain exact decimal strings as supplied by the gateway. Do not parse these strings through Number in your receiver. Preview uses a sample, not production telemetry. Transformed events are bounded to 240000 UTF-8 bytes.',
        ],
      },
      {
        title: 'Delivery and recovery',
        paragraphs: [
          'Persistence, routing and per-destination intent commit before the authenticated device receipt. External calls happen asynchronously. Provider acceptance does not prove subscriber processing. The same durable queue, eight-attempt/24-hour retry cycle, dead letters, fenced leases and manual recovery from Delivery apply to every adapter. At-least-once attempts can cause duplicates after remote success followed by a lost response. Deduplicate stable event IDs.',
          'Open Delivery to filter by destination and inspect each event’s attempt history, snapshotted routing version, mapping, failures and recovery actions. Replay targets the original destination/configuration only. After correcting a mapping, Retry failures with current mapping previews up to 100 eligible dead letters and explicitly requeues only those identities with the reviewed mapping version. The preview expires after ten minutes; payload retention and three recovery-cycle limits still apply. Provider acceptance IDs are recorded with attempts where returned. Rotating credentials affects future attempts, including old queued work. Pause first when changing resource access. Source payloads expire after seven days; diagnostics and audit history are retained for thirty days under the configured cleanup scheduler.',
        ],
      },
      {
        title: 'Security and current limits',
        paragraphs: [
          'Credentials are AES-256-GCM encrypted and bound to workspace and destination identity using a server-only integration key. Saved credentials are never returned to the browser. Replace credentials in Edit configuration to rotate them. Deleting a connection disables routing and erases its credentials while retaining delivery history.',
          'All endpoints require verified TLS and public addresses. Every DNS result is checked and the connection is pinned; redirects, private databases, metadata endpoints, arbitrary SQL and ambient cloud credential discovery are disallowed. Current safety limits are twenty integrations per workspace, thirty management/test actions per minute, bounded worker concurrency and the shared queue capacity. These are infrastructure safeguards, not new subscription plans.',
          'AWS uses official JavaScript SDK v3 with internal retries disabled. Azure and Google use their documented HTTPS APIs through the shared pinned transport. Current authentication is explicit AWS access/session credentials, Azure send-only SAS, Google service-account RSA credentials and PostgreSQL username/password plus optional CA. Role assumption, managed/workload identity, private connectivity, provider-native batch publication and additional connectors are not implemented. Local contract and PostgreSQL TLS tests are not authenticated live-cloud verification.',
        ],
      },
      {
        title: 'Versioned event example',
        paragraphs: [
          'New integrations use struct.event.v1. The stable event_id remains unchanged across retries. The timestamp is the stored sample timestamp, not proof of a trusted device clock. Schema metadata can be null for historical or unlinked slots. Original webhooks are not migrated to this envelope.',
        ],
        code: JSON.stringify(
          {
            format_version: 'struct.event.v1',
            event_type: 'telemetry.received',
            event_id: '00000000-0000-0000-0000-000000000001',
            device_id: '00000000-0000-0000-0000-000000000002',
            timestamp: '2026-10-11T15:00:00Z',
            schema: { slot: 0, version: 1 },
            data: {
              temperature: 23.5,
              humidity: 61.25,
              is_active: true,
              count: '18446744073709551615',
            },
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    slug: 'integrations-http',
    title: 'HTTP integration',
    summary: 'Signed JSON to a public HTTPS endpoint.',
    sections: [
      {
        title: 'Configure and verify',
        paragraphs: [
          'Create an HTTPS POST receiver. Enter its URL without embedded credentials or query parameters. Configure a signing secret and, optionally, a bearer token. Only nonsecret x-meta-* custom headers are accepted; Host, Authorization and cookie overrides are forbidden. The dedicated bearer token is encrypted. Basic verification validates configuration without contacting the receiver; explicitly confirm a test-send to verify actual acceptance.',
          'A 2xx response means endpoint acceptance. HTTP 408, 429 and 5xx retry; most other 4xx, redirects and invalid certificates are terminal. Requests time out after eight seconds. No redirects are followed and response bodies are discarded.',
        ],
      },
      {
        title: 'Verify the raw body and deduplicate',
        paragraphs: [
          'The existing raw-body HMAC algorithm is preserved: x-struct-signature equals sha256= plus the hexadecimal HMAC-SHA256 of exact transmitted bytes. New integrations use the versioned envelope; historical webhooks retain their old body. x-struct-event-id and x-struct-delivery-id identify the event and destination delivery. Do not deduplicate by signature because credentials may rotate.',
        ],
        code: `import {createHmac,timingSafeEqual} from 'node:crypto'
// raw is the bounded, unparsed request Buffer; never reserialize before verification.
const expected=Buffer.from('sha256='+createHmac('sha256',process.env.STRUCT_WEBHOOK_SECRET).update(raw).digest('hex'))
const provided=Buffer.from(request.headers['x-struct-signature'] || '')
if(provided.length!==expected.length || !timingSafeEqual(provided,expected)) throw new Error('Invalid signature')
const event=JSON.parse(raw.toString('utf8'))
// Atomically INSERT event.event_id into your unique inbox before business processing.
// Return 2xx only after your own durable acceptance.`,
      },
    ],
  },
  {
    slug: 'integrations-aws_sqs',
    title: 'AWS SQS integration',
    summary:
      'Standard and FIFO queue publishing with explicit scoped credentials.',
    sections: [
      {
        title: 'Queue and authentication',
        paragraphs: [
          'Use an existing commercial-region SQS queue. The queue URL must match https://sqs.REGION.amazonaws.com/ACCOUNT/QUEUE. China/GovCloud, custom endpoints and role assumption are not implemented. Enter an access key/secret and optional temporary session token for an IAM principal restricted to this queue. Rotate temporary credentials before expiration.',
          'FIFO queue URLs end in .fifo. MessageGroupId defaults to device ID or a configured fixed group. MessageDeduplicationId uses the stable delivery UUID. SQS deduplication is time-bounded and does not establish universal exactly-once processing. The worker sends one event per request; provider batch publication is not yet implemented. Queue ordering is not a guarantee of original device sequence ordering through retries.',
        ],
      },
      {
        title: 'Least privilege',
        paragraphs: [
          'SendMessage permits delivery. GetQueueAttributes is optional for read-only verification; send-only credentials can still deliver but the lookup may fail. Add specific KMS permissions separately if your encrypted queue requires them. Never supply administrator credentials.',
        ],
        code: JSON.stringify(
          {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['sqs:SendMessage', 'sqs:GetQueueAttributes'],
                Resource: 'arn:aws:sqs:us-east-1:123456789012:telemetry',
              },
            ],
          },
          null,
          2,
        ),
      },
      {
        title: 'Acceptance and errors',
        paragraphs: [
          'Struct requires a returned MessageId. Throttling, network failures and service outages use the shared retry policy. Invalid credentials, permissions, resource names and message configuration become visible failures. The JSON body contains the selected envelope; a struct_event_id message attribute also preserves identity. Receiving/consumer processing is outside this acknowledgment.',
        ],
      },
    ],
  },
  {
    slug: 'integrations-aws_eventbridge',
    title: 'AWS EventBridge integration',
    summary: 'Send telemetry to an existing event bus and reuse its rules.',
    sections: [
      {
        title: 'Configure an event bus',
        paragraphs: [
          'Choose a commercial AWS region and existing bus name, source (for example struct.telemetry), and detail type. Event detail contains the configured JSON envelope. Configure scoped access/session credentials. The adapter checks bus existence and validates each PutEvents entry; an HTTP 200 with FailedEntryCount is not delivery success. A concurrent deletion after the existence check remains a provider-side race; acceptance does not prove rule or subscriber processing.',
          'EventBridge rules can forward accepted events into your existing infrastructure. Struct does not create buses, rules, Lambda functions or paid resources. One entry is published per attempt.',
        ],
      },
      {
        title: 'Least privilege',
        paragraphs: [
          'DescribeEventBus is used to avoid silently publishing to an absent bus; PutEvents permits publication. Scope both to the selected bus and optionally restrict event source/detail type through AWS policy conditions.',
        ],
        code: JSON.stringify(
          {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['events:PutEvents', 'events:DescribeEventBus'],
                Resource:
                  'arn:aws:events:us-east-1:123456789012:event-bus/telemetry',
              },
            ],
          },
          null,
          2,
        ),
      },
      {
        title: 'Troubleshooting',
        paragraphs: [
          'Check region, bus existence, IAM resource policy, source and detail type. Per-entry throttling retries; per-entry permission/validation failures become terminal. Correct configuration, then recover eligible original deliveries from Delivery; replay does not route events to newly added destinations.',
        ],
      },
    ],
  },
  {
    slug: 'integrations-azure_service_bus',
    title: 'Azure Service Bus integration',
    summary: 'Queue and topic publishing through the HTTPS REST interface.',
    sections: [
      {
        title: 'Configure a queue or topic',
        paragraphs: [
          'Use an existing public Azure Service Bus namespace and queue or topic. Enter the namespace without its domain and the entity name without a path. Create an entity-scoped SAS authorization policy with Send permission only; configure its policy name and primary or secondary key. Do not use RootManageSharedAccessKey.',
          'The adapter creates a short-lived SAS token for each request and sends HTTPS POST /ENTITY/messages. BrokerProperties carries MessageId=delivery UUID, CorrelationId=event UUID and JSON content type. A 201 response is provider acceptance, not subscriber processing. REST is used to retain the shared DNS-pinned HTTPS boundary; AMQP SDK, sessions, scheduled messages, managed identity and Entra authentication are not implemented.',
        ],
      },
      {
        title: 'Verification and rotation',
        paragraphs: [
          'A send-only policy cannot safely inspect entity configuration, so basic verification validates configuration only. Explicit test-send proves the service accepted a synthetic event. Rotate through the alternate SAS key: replace Struct credentials, verify, then retire the old key. Existing queued jobs use replacement credentials. Azure recommends Entra identities when available; this initial adapter requires SAS and cannot connect to namespaces with SAS disabled.',
        ],
      },
      {
        title: 'Troubleshooting',
        paragraphs: [
          'HTTP 401/403 requires checking policy scope, key, namespace and clock synchronization. HTTP 404 indicates entity/namespace configuration. HTTP 429 and 5xx retry. No internal/private namespace connectivity is available. Message size is conservatively bounded by Struct’s 240000-byte transformed output limit; provider-tier limits still apply.',
        ],
      },
    ],
  },
  {
    slug: 'integrations-google_pubsub',
    title: 'Google Cloud Pub/Sub integration',
    summary:
      'Service-account-authenticated JSON publication with stable attributes.',
    sections: [
      {
        title: 'Topic and least privilege',
        paragraphs: [
          'Use an existing project and topic. Grant the service account roles/pubsub.publisher on this topic. Optional pubsub.topics.get permission is needed for read-only connection verification; do not grant project Owner or Editor. Enter its client_email and RSA private_key fields in the encrypted credential form. Service-account keys must be protected and rotated. Workload identity is not implemented.',
          'The adapter signs a short-lived RSA JWT and obtains an OAuth token from the fixed Google token endpoint, then calls the fixed Pub/Sub REST endpoint. It never follows token_uri from uploaded credential JSON or uses ambient metadata credentials. Publication uses base64 JSON and struct_event_id / struct_delivery_id attributes. Returned messageIds must contain one accepted publication.',
        ],
      },
      {
        title: 'Test and troubleshoot',
        paragraphs: [
          'Basic verification checks credentials and topic lookup where permitted; a principal with publish-only permissions may fail this read while publication remains possible. Explicit test-send is the publication test. HTTP 401/403 requires checking credentials and topic-level IAM. 404 indicates topic/project configuration; 429 and 5xx retry. Pub/Sub acceptance does not prove subscriber acknowledgment. Tokens are currently obtained per attempt; token caching and native batching are future efficiency work.',
        ],
      },
    ],
  },
  {
    slug: 'integrations-postgresql',
    title: 'PostgreSQL integration',
    summary: 'Verified TLS inserts into an existing customer-owned table.',
    sections: [
      {
        title: 'Prepare the destination yourself',
        paragraphs: [
          'Run the following in your own database with appropriate administrative access. Struct does not create or alter customer tables. Give the integration user only CONNECT, schema USAGE, INSERT and the column SELECT permissions required by verification and idempotency. Use your actual role/database names. event_id must be a non-partial single-column unique or primary key.',
        ],
        code: `CREATE TABLE public.struct_events (
  event_id uuid PRIMARY KEY,
  device_id uuid NOT NULL,
  received_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
GRANT CONNECT ON DATABASE telemetry TO struct_writer;
GRANT USAGE ON SCHEMA public TO struct_writer;
GRANT INSERT, SELECT ON public.struct_events TO struct_writer;`,
      },
      {
        title: 'Connection and mapping',
        paragraphs: [
          'Enter a public host, port, database, schema, table, username/password and optionally a PEM CA certificate. TLS verification cannot be disabled. Private addresses and arbitrary connection strings are rejected; private connectivity is not implemented. Each connection validates DNS and pins the IP while verifying the original hostname. A bounded pool allows one connection per configuration with a process-wide maximum of 32 pools.',
          'Inserts use fixed parameterized SQL with validated identifiers. Mapping controls the JSON payload column, not arbitrary SQL expressions or arbitrary database columns. event_id, device_id and received_at columns come from stable source metadata. ON CONFLICT(event_id) DO NOTHING treats an existing event as idempotent acceptance; Struct does not overwrite it. Different integrations writing the same table intentionally deduplicate by event ID.',
        ],
      },
      {
        title: 'Verification and failure recovery',
        paragraphs: [
          'Basic verification checks the TLS connection, target columns, INSERT privilege and unique event key without inserting a reading. Explicit test-send performs a synthetic insert. A successful autocommitted insert, or an already-existing event ID, is reported as accepted. Network/timeout/outage errors retry; deterministic SQL schema/permission/value errors are terminal. Fix the table/credentials and retry while the source payload remains available. Statement and query timeouts bound operations.',
        ],
      },
    ],
  },
]
