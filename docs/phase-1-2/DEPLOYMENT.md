# Deployment review prerequisites

**Nothing in this task was deployed or applied to production.** Do not deploy the updated app before migration 034. A build passing locally does not create the new database functions.

## Database changes

`supabase/migrations/034_workspace_onboarding.sql` adds:

- Organizations: `first_telemetry_at`, `onboarding_dismissed_at`.
- Devices: `first_telemetry_at`, `starter_downloaded_at`, `configuration_acknowledged_at`, `expected_report_interval_ms` (1 second through 7 days).
- `record_first_telemetry` AFTER INSERT trigger on telemetry, operating in the insertion transaction.
- Member-scoped read RPC `workspace_onboarding`.
- Writer-scoped `dismiss_workspace_onboarding` and `update_device_setup` RPCs.
- Service-role-only `create_secure_device_with_usage`, wrapping current device creation and Secure V2 enrollment atomically.

The new progress columns are not directly writable by authenticated clients. RPCs check workspace membership/writer permissions; trigger function execution is not exposed to clients. Existing RLS and ingestion authorization remain in force.

Backfill uses retained telemetry, durable V1 event identities, and committed Secure V2 packet event IDs. If only durable proof remains, migration time records evidence recognition rather than inventing the original first packet timestamp. `last_seen` alone is excluded. Where no reliable evidence survives, the writer can dismiss Getting Started without falsifying successful packet evidence.

## Order

1. Review and back up using the normal deployment process. Confirm migrations through 033 exist in the target database.
2. Review/run 034 during an approved deployment window. Its history backfill may scan existing ingestion/telemetry tables; production execution time was not measured locally. It has not been automatically applied.
3. Confirm existing Secure V2 availability/runtime flag and credential-encryption configuration are already enabled and correct. New device creation now fails closed if Secure V2 is unavailable. Do not print or share secret values.
4. Deploy the reviewed web application and generated public SDK archives. No gateway wire-format change is required by this task.
5. Validate sign-in, email callback, one disposable customer device/slot, starter export, first stored packet, reload/retention behavior, billing refresh and mobile navigation using approved staging/test accounts.
6. Measure production page/API latency and Web Vitals. Local fixture timings cannot establish customer performance.

Supabase redirect allowlists must permit the existing site `/confirm` callback and intended production origin. This task did not change provider settings. No new paid service, plan, Stripe configuration or environment secret was introduced.

## Compatibility and rollback

Existing legacy ingestion code, endpoints and schema definitions are preserved. Normal new devices enroll in Secure V2; existing historical tools are separated. Enrollment does not by itself revoke a legacy credential, so coordinate retirement rather than assuming a UI change disables firmware.

The migration is additive. Prefer rolling back application code while leaving additive progress data intact if a web regression occurs. Do not drop progress columns or delete customer records as an automated rollback. The wrapper function preserves existing device-count/usage checks and rolls back failed enrollment. Published slots and credentials should never be reset to work around an onboarding failure.

## Residual validation

PGlite tests verify transaction rollback, idempotent updates, RLS/RPC permissions and retention persistence. They do not exercise multiple PostgreSQL backend processes simultaneously. The conditional first-milestone updates are designed to serialize concurrent first commits; confirm under a real PostgreSQL concurrency test in staging before claiming load-tested concurrency.

Live account inventory and legacy retirement need production evidence. Physical ESP32 upload/Wi-Fi, actual SMTP/OAuth verification and live Stripe customer refresh were not performed. No production subscriptions were created to test Free-state messaging.
