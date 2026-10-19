# Phase 7 — Bring your own backend

Implementation and local verification completed October 12, 2026. **Not deployed, not pushed, migrations not applied to Supabase.** Phase 3/4 is also local and is a required dependency. Activation flags remain off by default.

Read the [final local report](FINAL-REPORT.md). Start with [audit](AUDIT.md), [architecture](ARCHITECTURE.md), [verification and limitations](VERIFICATION.md), and [deployment review](DEPLOYMENT.md). Machine-readable [capabilities](capabilities.json), [official references](references.json) and [evidence manifest](evidence/manifest.json) accompany the implementation. Evidence is synthetic and contains no customer credentials.

## What works locally

- Six real destination adapters: signed HTTPS, SQS (standard/FIFO), EventBridge, Service Bus queue/topic, Pub/Sub and verified-TLS PostgreSQL.
- Existing Secure V2 transaction → bounded routing expression → per-destination outbox → existing fenced worker/retries/dead letters. No additional queue or device wire overhead.
- Multiple independent destinations; versioned configuration and routing/mapping snapshots; safe credential replacement; pause, resume, disable and soft deletion.
- Declarative field selection/rename and metadata selection, preserving Float64 and exact decimal strings for large integers. No user code or numeric narrowing.
- Guided seven-step Integrations dashboard, read-only verification, explicitly confirmed synthetic publication, sample rule/mapping preview, health summaries, shared Delivery traces and recovery.
- Explicit failed-job recovery with current mapping: preview up to 100 event identities, confirm within ten minutes, retain original target/routing, audit the reviewed mapping version and avoid duplicate scheduling.
- Server-only AES-256-GCM credentials bound to tenant/destination; pinned public-network connections, verified TLS, parameterized PostgreSQL inserts, tenant/writer authorization and management/recovery limits.

## Provider verification boundary

| Adapter | Authentication implemented | What was actually tested | Live service verified? |
|---|---|---|---|
| HTTPS | HMAC-SHA256; optional bearer | Real local HTTP receiver and HMAC verification, shared worker recovery | No customer HTTPS destination used |
| SQS | Explicit AWS access key, optional session token | Official SDK v3 serialization/signing against local HTTP contract receiver; FIFO IDs | No AWS IAM/queue |
| EventBridge | Same AWS credentials | Official SDK v3, bus lookup, entry success/failure contract | No AWS bus |
| Service Bus | Entity-scoped SAS | Documented REST request and independently checked SAS signature | No Azure namespace |
| Pub/Sub | RSA service-account JWT → OAuth | Local RSA assertion verification, token/publication contracts and message IDs | No Google IAM/topic |
| PostgreSQL | User/password, optional CA | Actual PostgreSQL 18.4 over verified TLS 1.3, concurrent idempotent inserts and certificate rejection | No customer database |

These tests demonstrate real encoding, signing, SQL and pipeline behavior; they do not establish live-cloud interoperability, provider quotas or production fleet capacity. A cloud adapter is implemented, but its hosted-service acceptance remains a staging prerequisite.

## Important files

- `supabase/migrations/036_backend_integrations.sql`: integration metadata, routing, versioned saves/actions, atomic fanout, old-worker fencing, provider receipts, mapping recovery and retention.
- `tcp-server/integrations/`: adapter registry, validation, encryption, transformations, HTTPS/provider transport and dispatch.
- `tcp-server/outbox.js`, `worker.js`, `webhooks.js`: extend the Phase 3/4 infrastructure.
- `web/server/api/integrations/` and `web/server/utils/integrations.ts`: authenticated, bounded server APIs; no stored-secret responses.
- `web/app/pages/dashboard/integrations.vue`, `IntegrationRuleEditor.vue`, `IntegrationMappingEditor.vue`: configuration and diagnostics.
- `web/app/components/DeliveryEventTrace.vue`: original decisions, reviewed recovery mapping and provider receipts.
- `web/shared/integrationGuides.ts`: seven customer guides under `/docs/integrations*`.
- `tests/integrations/`, `web/server/utils/integrations.test.ts`, `web/test/integrations/`: reproduction and regressions.

Existing webhook payload/signature formats, current device firmware, Protocol Lab and landing page remain compatible. Historical telemetry is never automatically replayed or routed to new destinations.

## Remaining work before production acceptance

Run authenticated AWS/Azure/Google staging tests, real hosted Supabase/PostgREST end-to-end authorization checks, production-like multi-worker/load testing, reviewed secret provisioning and retention/rollout operations. See VERIFICATION.md for unsupported features rather than treating Phase 7 as fully production-validated.
