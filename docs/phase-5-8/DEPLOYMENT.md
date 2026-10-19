# Deployment and rollback — review only

No commands in this guide were executed against production. Migration 038 and feature flags are disabled by default. Coordinate this release with the pre-existing uncommitted migrations 035–037 and their gateway/worker/API changes; this checkout is not a standalone patch to an arbitrary older production database.

## Prerequisites

1. Review the Phase 3/4 durable outbox, Phase 7 integration and Phase 6 fleet rollout guides. Confirm all prerequisite migrations and service-only grants are applied in a disposable staging project first.
2. Review `038_monitoring_analytics.sql`, including the bounded retained-event last-commit backfill. Measure its query/index creation impact on a representative staging snapshot before scheduling a production maintenance window. It does not regenerate keys or overwrite schema slots.
3. Supply existing private `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` to the gateway and observability worker through the existing secret manager. The web server uses its existing private Supabase service configuration. Never add keys to public Nuxt variables.
4. Email additionally requires private `RESEND_API_KEY` and `STRUCT_ALERT_EMAIL_FROM` using an already verified sender. Without them email work is terminal configuration failure; do not enable email rules until staging provider acceptance/recovery is verified. Customers must separately opt in. Existing signed webhook delivery requires the established delivery worker.

## Ordered rollout

1. Apply additive migration 038 through the reviewed Supabase migration process. Do not automatically run historical analytics backfill. Validate RLS, service grants, existing five-argument ingest RPC and existing delivery/fleet queues.
2. Deploy the observed RPC caller and collector with `STRUCT_OBSERVABILITY_ENABLED=false`. Confirm unchanged secure ingestion and receipts.
3. In an isolated staging project, activate the database row and set `STRUCT_OBSERVABILITY_ENABLED=true` for gateway, web APIs and worker. This release has a global database/server gate, not a per-workspace rollout switch; controlled workspace testing requires a separate project until tenant rollout gating is added.
4. Start the worker with private environment injection. Run from the repository's `tcp-server` directory:

   ```sh
   node observability-worker.js
   # Or, after staging approval:
   pm2 start ecosystem.observability.config.cjs
   pm2 logs struct-observability
   pm2 describe struct-observability
   ```

   The supplied PM2 definition has one fork and a provisional 256 MB restart threshold. Size it from staging measurements; PGlite benchmark RSS includes an embedded database and is not the production worker requirement. Multiple workers are database-safe, but add them only after measuring fairness, database locks and queue recovery.

5. Build/deploy the existing website with `NUXT_PUBLIC_OBSERVABILITY_ENABLED=true`; this exposes navigation only. Both API and database gates remain authoritative. No external notification is automatically enabled. Workspace defaults are no-expectation and rules start disabled.
6. Use disposable devices and selected customer-controlled staging destinations to test packet accounting, timed inactivity/recovery, exact wide values, duplicate handling, shared webhook attempts, email opt-in/out, notification retries and maintenance suppression. Review actual timestamps and coverage indicators.
7. Watch commit latency and throughput against the baseline, metric pending depth/age, `last_aggregated_at`, known gaps, gateway collector drops, worker last-success/error counts, alert evaluation age, outbox backlog and email terminal failures. Run retention cleanup under load. Enable real traffic only after explicit production rollout approval.

## Health and recovery

The worker logs safe counters every 30 seconds. It aggregates 200 rows/cycle, evaluates up to 20 rules and retries up to 20 due scheduling intents. Idle/error delays are one/three seconds; full metric batches shorten the next delay. Cleanup runs every 3,600 successful cycles, which is not a strict wall-clock hourly guarantee. Monitor cleanup progress separately during sustained backlog.

When aggregation fails, source rows remain pending. Restarting the worker is safe. For an incident enqueue failure, inspect transition scheduling attempts and errors; the incident remains durable. Email lease expiry recovers unknown outcomes, and stable idempotency keys reduce duplicate provider acceptance. Shared webhook recovery remains governed by Phase 3/4 policy. Never manually delete pending jobs to make dashboards appear healthy.

Historical backfill is deliberate: `observability_backfill(org_id, actor_id, cursor, limit)` is service-only, authorization checked, and reading-only. Inspect its actual signature in migration 038 before scripting it. It cannot restore lost application/network bytes or membership snapshots. Do not automatically turn historical readings into notifications or customer webhook deliveries.

## Rollback

1. First disable/mute rules or set maintenance, stop notification/evaluation work and pause affected existing alert webhook jobs through supported recovery controls. Already dispatched requests cannot be recalled. Do not leave inactivity rules enabled while disabling the data source that updates their last-commit clock.
2. Turn off public navigation and web/gateway observability flags, then stop `struct-observability`. Revert application instrumentation only after the existing commit path is verified.
3. Retain additive tables, incident history, transition intents, queued deliveries, aggregation cursor state and deduplication identities. Do not drop migration 038 or roll back by deleting customer work. Pause/gate cleanup appropriately until the operational recovery plan is agreed.
4. Existing Secure V2 device firmware, identities, root secrets, epochs/counters and schemas remain unchanged. The old commit RPC remains available. Resume shared delivery workers as appropriate for unrelated telemetry; do not disable an entire tenant's telemetry deliveries solely to hide an alert failure.
5. Before reactivation, review coverage gaps and expired backlog, restore collection, aggregate pending work, then resume evaluators and notifications deliberately. This release does not promise recovering best-effort observations lost before durable storage.

Production readiness requires hosted Supabase/PostgREST/RLS and live provider checks, representative sustained load, operational retention approval and end-user policy review. Local results in VERIFICATION.md are not automatic deployment authorization.
