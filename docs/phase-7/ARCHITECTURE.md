# Integration architecture and contracts

## One durable lifecycle

Secure V2 packet authentication, replay checks, schema decoding and `ingest_secure_v2_telemetry` remain unchanged. Each logical reading keeps its existing UUID. The `enqueue_telemetry_webhooks` AFTER INSERT trigger stores the event record and all matched destination delivery rows inside that ingestion transaction. A rollback stores neither; the device receives a committed receipt only after the existing RPC succeeds. External network requests never run in this transaction.

Integration routing is enabled only by the service-only `integration_settings` flag. Existing legacy destinations keep their original payload and signature. Integration-managed destinations are excluded from the legacy branch and best-effort connection hooks when the integration runtime flag is enabled. Each `(event_id,destination_id)` remains unique. Multiple matches in an expression cannot multiply delivery rows.

Each integration has a single bounded AND/OR rule, rather than an independent rule catalog. Fields: device_id, schema_slot, linked schema_version, event_type and payload paths. Operators: eq/ne, numeric gt/gte/lt/lte, string contains, exists. At most 64 expression nodes, five nested levels, sixteen children per group. Numeric thresholds use PostgreSQL NUMERIC; unsafe JavaScript integers must be supplied as decimal strings. Equality remains type-specific. Missing, null and invalid comparisons fail closed. Conditional routing uses the existing Scale entitlement; downgrade does not widen an existing condition into all telemetry.

The job snapshots kind, configuration version, nonsecret configuration, matching rule, mapping and schema metadata at commit. Configuration changes affect new events. Credential replacement applies to future attempts, including old jobs. A pause stops new claims while still allowing matching events to queue; disable stops new routing and queued attempts can become terminal. In-flight requests may finish. Soft deletion erases encrypted credentials and preserves history. Direct browser writes/deletes of managed destination rows are rejected; integration changes use versioned server APIs.

## Shared scheduler and adapter contract

`getAdapter(kind)` exposes validation, verification, delivery and factual capability metadata. All adapters return shared delivered/retry/dead outcomes, safe error category, status/latency and optional provider receipt. SDK internal retries are disabled. Only the existing SQL/worker scheduler owns retries and leases.

Migration 036 wraps the Phase 3/4 claim function. An old v2 worker fails closed once integrations activate; new workers call `claim_integration_deliveries`. The same SKIP LOCKED scheduler, per-tenant/destination capacity, UUID lease and fencing checks apply. Completion plus provider receipt is a single `finish_integration_delivery` transaction. Receipt IDs for SQS, EventBridge and Pub/Sub are bounded and stored on the real attempt. Azure/HTTP acceptance and PostgreSQL insert outcomes have no invented provider receipt.

Success means HTTP 2xx, SQS MessageId, individual EventBridge EventId without entry errors, Service Bus HTTP 201, Pub/Sub messageId, or PostgreSQL committed insert/existing event ID. None proves downstream subscriber processing. AWS bus existence is checked before PutEvents because a nonexistent bus can otherwise silently discard an accepted request. Deletion between lookup and publish remains a provider-side race; acceptance is not downstream processing.

At-least-once outbound attempts can duplicate remote effects after a lost response or worker crash. Stable event IDs support customer deduplication. SQS FIFO deduplication uses stable delivery ID and an explicit group/device; Azure MessageId uses delivery ID and CorrelationId uses event ID. PostgreSQL requires UNIQUE(event_id) and uses parameterized INSERT ... ON CONFLICT DO NOTHING.

## Credential and networking boundaries

A separate server-only 32-byte `STRUCT_INTEGRATION_KEY` encrypts JSON credentials with AES-256-GCM, random 12-byte IV, 16-byte tag and AAD containing workspace/destination IDs. Browser responses never include stored secrets or ciphertext. Credentials only enter server-side decryption for delivery/verification. Keys are not stored in the same database. Current envelope has no key-ID ring: replacing the encryption key without deliberate re-encryption would make existing integrations unreadable. Deployment docs describe coordinated rotation.

AWS endpoints are region-derived and SQS URL/region/account paths restricted; no custom endpoints, ambient credentials or role discovery. Azure namespace/entity and Google project/topic construct fixed HTTPS APIs. Azure SAS and Google JWT/OAuth use documented REST through the pinned transport. Private connectivity and managed/workload identity are future work.

HTTPS resolves all DNS answers, rejects private/reserved addresses, pins actual socket lookup, verifies certificates, rejects redirects, and bounds headers/body/time. PostgreSQL resolves public addresses and connects to the pinned IP while validating the certificate against the original hostname. Pools are bounded to 32 cache entries with one connection each, ten-second idle timeout and statement/connect deadlines. Standard destination configuration never accepts SQL or a DSN. Identifiers are validated/quoted; data is parameterized. Response/error diagnostics never retain provider bodies or credentials.

## Transformations and event format

New integrations explicitly use `struct.event.v1`; historical webhooks are unchanged. Required format_version, event_type and event_id; optional device_id, timestamp and schema; either data object or flat fields. Field selection/rename, required/optional source, identity/scalar-to-string/explicit boolean conversions only. No arbitrary code, template engine or SQL. Bounded 100 mappings and 240000 UTF-8 output bytes. Float64 remains JSON round-trip precision, 64-bit integer strings stay exact. Flat metadata collisions and invalid/missing required values fail visibly and do not retry forever.

Schema identity is a device slot plus linked legacy version where present, not a global schema registry. Timestamps are server-stored sample timestamps, not proof of device-clock accuracy. PostgreSQL columns store original event identity/device/timestamp plus transformed JSONB; custom per-reading table column mappings are not implemented.

## Recovery, retention and audit

Normal retries retain the original snapshot. After a deterministic mapping failure, a writer may explicitly preview/requeue dead jobs using the reviewed current mapping. The preview stores at most 100 IDs in existing delivery_actions, expires after ten minutes, and confirmation cannot expand to newly failed jobs. The original event, target, rule and configuration version remain; mapping_version records the deliberate replacement. Repeated request UUIDs are idempotent; tenant authorization and existing three-cycle/payload-age limits apply.

Shared defaults: eight attempts/24h automatic cycle, bounded exponential backoff/jitter, Retry-After up to one hour, seven-day copied delivery payload, thirty-day metadata/audit, 100000 pending-work ceiling per workspace. Exceeding queue capacity rolls back ingestion rather than acknowledging missing work. Cleanup relies on the existing scheduled retention job; paused/outage work does not have indefinite retention. Route/filter changes never backfill old readings or replay to newly created targets.

## Dashboard and API

Member reads and owner/admin writes are enforced server-side before service queries. Integration tables are service-only; audit reads are tenant RLS. APIs accept same-site JSON streams up to 64 KiB, reject stale versions, enforce management/test limits and no-store responses. Preview returns routing/mapping results without network traffic. Basic checks distinguish configuration-only checks (HTTP/Azure), credential/resource lookup (AWS/Google), and verified connection/schema checks (PostgreSQL). Explicit synthetic publication requires confirmation and is separately audited.

The guided dashboard saves new connections disabled, shows credential-free configuration, exposes explicit activation and links to existing Delivery history/replay. Traces use stored snapshots and attempts, never fabricated per-stage timestamps. Browser tests use mocked API responses; separate database/provider tests verify the implementation boundaries underneath.
