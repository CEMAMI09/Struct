# Phase 6 audit and design

Audit: 2026-10-12. Scope is the organization (existing workspace), with owner/admin writes and member reads. No production access or deployment is required.

- The devices composable loads the entire organization and polls every loaded ID. The new fleet inventory will use bounded server queries; existing small-device workflows remain available.
- Migrations 016/028 implement synchronous legacy bulk imports and quote receipts. They are not a Secure V2 manufacturing flow and have no crash-recoverable item queue. Keep compatibility APIs; add logically separate fleet jobs.
- Secure V2 enrollment in 033/034 already generates a unique wire ID per credential epoch. Reprovisioning keeps the database device UUID, allocates a new wire ID, and revokes previous keys with zero grace. Firmware must be physically/manual reconfigured: there is no remote rotation transport.
- Credentials use random 32-byte secrets encrypted with existing AES-256-GCM server key. No new fleet-wide key or alternate identity scheme is needed. Normal inventory/export must omit all credentials.
- Credential revocation is checked on every Secure V2 packet; only decrypted key material is cached. Device enable/disable state does not yet exist. Add a lifecycle guard both in gateway lookup and database ingestion/bootstrap/enrollment to prevent races or alternative paths.
- MAC and profile/hardware identity already have organization uniqueness. Add distinct optional external ID and serial identity, preserving device IDs and existing key/value tags.
- Existing plan enforcement is the organization-serialized device-count trigger and usage high-water system. Bulk enrollment must invoke the real create/enroll transaction, never bypass it or mutate Stripe subscriptions.
- 035/036 provide durable delivery, retries and versioned routing snapshots. Device administration needs its own item queue, not webhook jobs. Reuse PostgreSQL lease/fencing conventions. Future-only group/tag routing extends the existing matcher and enqueue trigger.
- Immutable schema slots are per device. Bulk registration may copy an explicitly selected authorized source slot, with its encoding and definition snapshotted at preview. It must not overwrite existing slots or pretend firmware changed.

Design: additive migration 037; default-off server/UI/worker flags. Flat multi-membership groups (no ambiguous ancestor routing), normalized label arrays separate from historical tags JSON. Preview snapshots capture exact device IDs and administrative versions, expire in 30 minutes and require confirmation. Maximum 10,000 items/job, two queued/running jobs/workspace and 20 previews/hour; one bounded item transaction at a time per worker, leases recover after 60 seconds. Invalid/stale items fail individually. Cancellation stops uncommitted items; completed changes stay committed. Soft deletion preserves telemetry/delivery and continues to count under existing billing semantics; no automatic billing benefit is claimed.

Credential exports are a separately confirmed, audited one-time manufacturing-manifest disclosure for at most 100 devices from the requesting user's create job. Existing authorized per-device starter downloads remain a separate workflow. Rotation is explicit manual reprovisioning, never automatic remote application. No secrets in job inputs, reports, URLs or diagnostics.
