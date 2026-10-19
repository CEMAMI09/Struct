# Phase 7 audit — 2026-10-11

Audited before Phase 7 implementation. Phase 3/4 is local, not yet deployed; migration 035 and worker activation remain prerequisites.

## Existing implementation

Secure V2 authentication, replay protection and batch reading identity already exist. `ingest_secure_v2_telemetry` commits readings and the `enqueue_telemetry_webhooks` trigger atomically. Device receipts follow the database commit. Migration 035 adds persistent event metadata, fenced leases, shared retry scheduling, attempt history, dead letters, bounded recovery, tenant authorization and queue limits. No protocol or firmware change is needed.

Destinations currently represent HTTPS webhooks only. Their existing payload and raw-body HMAC contract must be preserved. The dashboard creates them directly through scoped database access. Scale has a single optional payload condition. There is no provider registry, encrypted external credential vault, rich declarative rule model, transformation version, or provider connection verification. Delivery work already has unique `(event_id,destination_id)` identity, so another queue would duplicate a working abstraction.

## Risks and required design

* Freeze nonsecret provider configuration, routing and mapping with each queued delivery. Credential rotation may change credentials, but must not silently retarget old work.
* New integration secrets need authenticated encryption bound to tenant/destination identity and a separate environment key. Existing signing-secret reveal behavior belongs only to legacy webhooks; never add external credentials to it.
* User-controlled endpoints and database hosts are SSRF boundaries. Validate every DNS answer and pin the actual connection; require TLS certificate verification. Provider endpoints must be constructed or allowlisted, never arbitrary credential-bearing URLs.
* SDK retries must be disabled: the existing durable scheduler owns retries. A provider HTTP 200 may still contain per-entry failures.
* Preserve precision: gateway JSON already represents large integers as strings; transformations must not coerce them to JavaScript numbers. Routing numeric comparisons need decimal-safe semantics.
* Existing subscription routing restrictions must remain enforced; no pricing/entitlement redesign.
* New integrations are disabled on creation. Separate read-only verification from explicit test publication. No setup action may silently publish real telemetry.

## Planned additive changes

Migration 036 will attach versioned integration definitions and server-only encrypted secrets to existing destinations, snapshot decisions into existing delivery rows, and reuse existing worker claims/completion/recovery. New server APIs enforce owner/admin writes and member reads, with bounded configuration and output. An Integrations page will coexist with historical webhook configuration and link to Delivery for attempts and recovery. New activation flags default off. No historical backfill or automatic rerouting.

External network calls remain outside ingestion. Routing is bounded and resolved in the ingestion transaction. Destination pacing, tenant fairness, retries, dead letters and retention are inherited from migration 035. Local tests must distinguish contract emulation from authenticated live-cloud verification.
