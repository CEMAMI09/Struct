# Enterprise operations audit — October 16, 2026

This checkout is based on commit 27be12d with uncommitted Phases 3/4, 6, 7 and 5/8. Their code and local evidence exist; no production rollout is inferred. This audit precedes Phase 9 changes. No hosted database, credentials, customer records or cloud services were accessed.

## Existing foundation

Organizations and organization_members already support multiple tenants and owner/admin/viewer roles. Personal organization creation is atomic. Dashboard switching uses an authorized membership list, per-request isolation and guarded stale responses. Business resources have organization_id; user_id remains historical creator metadata. Removing a membership does not remove devices, but deleting an auth user can still cascade creator-linked records and requires separate protection.

Migration 026 closes direct membership and billing writes, restricts device/credential columns, guards role changes with advisory locks and removes historical device/destination secrets from audit snapshots. Secure V2 keys, immutable slots and replay state are service-only and independent of human sessions. Existing five-argument ingestion and authenticated commit receipts must remain unchanged.

Phases 3/4 supply durable event/outbox persistence, fenced delivery leases, retries/replay and safe URL transport. Phase 7 supplies encrypted adapter credentials, routing snapshots and local provider contracts. Phase 6 supplies groups/tags, bounded administrative jobs and one-time provisioning manifests. Phase 5/8 supplies metrics rollups, timed health/alert evaluation, durable incidents and bounded notification work. These are reusable prerequisites, not reasons to create another queue or tenant model.

## Gaps and risks

- Team UI calls add_org_member_by_email, which immediately adds an existing account and reveals account-existence errors. There is no expiring, accepted invitation lifecycle or invitation mail transport.
- Role logic is duplicated between frontend, APIs and SQL. Generic writer authorization also gates billing, secrets, replay and bulk operations. Developer/operator roles do not exist; adding frontend role names alone would leave direct-RPC gaps.
- Existing audit_logs covers devices/schemas/destinations with CRUD snapshots. Later phase tables have separate audit fragments. Service-role actions often have a null human actor, and request correlation is absent. Legacy trigger ignores only last_seen; new activity-only columns can generate per-packet administrative audit noise. Snapshot redaction should become a strict field allowlist. Historical unknown actors must not be fabricated.
- Audit access already requires the existing Scale entitlement. Team changes are likewise Scale-gated. These benefits and prices must stay unchanged. No new seat charge or billing role is justified by the existing model.
- Secret-retrieval, delivery-recovery, schema publication and service-only actor-parameter RPCs need explicit capability classification. Service-role grants are not proof of human authorization. Existing session/token revocation behavior does not provide machine management credentials.
- Gateway/worker logs and delivery-health CLI exist, but no shared freshness-aware heartbeat history or protected enterprise operations overview exists. Process liveness does not establish public network availability or accepted device commits.
- Supabase backup/PITR configuration and offsite key backup are unknown. Local test tooling contains disposable PostgreSQL 18.4; representative actual dump/restore can be tested without production access. Restoring old replay state must not reopen ingestion until epochs or independently current replay watermarks are reconciled.
- Current hosting depends on Nuxt/Supabase Auth/PostgreSQL plus independently configured gateway/workers. Dedicated/private deployment is not production-qualified. A local isolated reference can validate configuration boundaries without provisioning infrastructure or distributing production keys.

## Implementation direction

Extend the existing role enum in a separate committed migration step, then add centralized capability data, guarded organization/team commands, hashed expiring invitations, one-time scoped management keys and append-only enhancements to audit_logs. Preserve legacy APIs with explicit authorization and database-side guards. Bridge phase-specific audit intent without copying secrets or telemetry payloads. Add bounded search/export, freshness-aware operational probes, recovery protections and a tested isolated reference. Keep new customer interfaces explicitly gated until migrations and backend compatibility are reviewed.

Baseline local SQL measurements are in evidence/baseline.json (100 samples, empty audit history, PGlite; excludes hosted Auth/PostgREST and browser time). No existing production availability, backup coverage, RTO/RPO, certifications or contractual SLA is claimed.
