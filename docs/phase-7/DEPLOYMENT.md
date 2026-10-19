# Deployment review

This is a runbook for operator review. No production deployment, database migration, provider resource or PM2 change was executed.

## Prerequisites

Phase 3/4 migration 035 and its reviewed worker rollout are prerequisites. Read `docs/phase-3-4/DEPLOYMENT.md`. Phase 7 migration 036 defaults `integration_settings.enabled=false`. Both migrations remain local and unapplied. There is no automatic historical backfill.

Install lockfile dependencies in both `tcp-server` and `web` before building. AWS SDK v3 and pg are server-only dependencies resolved through the sibling integration module. Azure/Google use documented HTTPS APIs. Nuxt traces these modules into the server; provider SDKs are not shipped in normal browser bundles.

| Setting | Location | Purpose |
|---|---|---|
| SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY | Existing gateway/worker private environment | Trusted database access |
| STRUCT_DELIVERY_PIPELINE_V2=true | Worker | Existing Phase 3/4 scheduler |
| STRUCT_INTEGRATIONS_ENABLED=true | Worker, gateway and web server | Adapter claims/APIs; exclude managed destinations from legacy connection hooks |
| STRUCT_INTEGRATION_KEY | Web server and worker only | Same separately protected random 64-hex key; never public |
| NUXT_PUBLIC_INTEGRATIONS_ENABLED=true | Web build/runtime | Display management UI; does not activate database forwarding |
| NUXT_PUBLIC_DELIVERY_PIPELINE_ENABLED=true | Web build/runtime | Shared Delivery UI |
| OUTBOX_EMBEDDED=false | Gateway | Avoid duplicate embedded/standalone dispatchers |
| OUTBOX_CONCURRENCY=8, OUTBOX_HEALTH_PORT=9092 | Worker template | Bounded concurrency; loopback health |

The web application retains its existing Supabase private/public variable conventions. Never make the service key or integration encryption key public.

Generate the integration key with an approved secret manager. Store it separately from database records and device master keys; back it up under restricted access. There is no automatic key ring/rewrap job. Encryption-key rotation requires paused dispatch/configuration writes, controlled decryption with the old key, re-encryption using the same tenant/destination AAD, verified counts/decryption, coordinated key replacement on all processes and resumption. Simply replacing the environment key makes existing credentials unreadable. Provider credential replacement is supported independently in the dashboard.

## Staged rollout

1. Review changes, migration dependencies, backups, backlog and retention scheduler. Do not provision paid services automatically.
2. Apply 035 followed by 036 through the normal reviewed Supabase migration mechanism. Each file must be applied transactionally; do not rerun a recorded migration. For a disposable direct staging database, the equivalent for 036 is `psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/036_backend_integrations.sql` after 035.
3. Deploy adapter-capable code with integration activation off and no enabled integrations. Install `npm --prefix tcp-server ci --omit=dev` and the web build dependencies. Preserve existing webhook/SDK behavior.
4. Provision the private integration key on web/worker. Configure the gateway integration flag and OUTBOX_EMBEDDED=false before exposing managed destinations. Restart only operator-identified processes through the established procedure.
5. Drain/stop old workers. Activate the Phase 3/4 database flag if necessary, then explicitly set `public.integration_settings.enabled=true` for its singleton row. Start only an adapter-aware worker with both runtime flags. Old v2 claimers now fail closed with UPGRADE_INTEGRATION_WORKER; work remains durable during handover.
6. With private environment already configured, standalone startup from repo root is `pm2 start tcp-server/ecosystem.delivery.config.cjs --update-env`. If a worker already exists, use its operator-confirmed name and reviewed restart procedure instead of creating another process. The template is named struct-delivery, sets v2=true and inherits the integration flag/key from private environment. Direct alternative: `npm --prefix tcp-server run start:worker` with the same settings.
7. Check `curl --fail http://127.0.0.1:9092/health`, `npm --prefix tcp-server run delivery:health`, queue age/depth, leases, retries and PM2 restarts. Extra workers need separate health ports, or port=0 plus process monitoring. Review the template's 256 MiB restart threshold against actual server memory.
8. Expose dashboard management only after database/worker health. Create disabled staging destinations. Verify read-only checks do not publish; explicitly send synthetic events. Test real IAM, permissions, TLS, provider acknowledgments and failure classification. No existing connection is auto-enabled.
9. Enable selected customer-controlled staging connections deliberately. Send disposable telemetry through the real hosted Secure V2 path. Verify stable event IDs, per-destination work, receipts and downstream data; exercise retry/recovery, pause, version changes and cross-tenant authorization.
10. Measure production-like workload/resource behavior before capacity claims. Monitor provider quotas, queue caps, old work and retention sweeps.

## Migration inventory

036 adds integration_settings, integration_definitions and integration_audit; tenant/time indexes and audit RLS; destinations.integration_managed and direct-write protection; webhook_deliveries.integration_snapshot; webhook_attempts.provider_receipt. Definitions/ciphertext have service-only grants. New RPCs provide versioned configuration/actions, bounded matching, adapter-aware claims/completion, explicit mapping recovery and safe event detail. Existing ingestion and retention functions are extended; there is no second queue.

No device, schema definition, packet format, subscription plan or historical webhook configuration is changed. Existing work keeps its age and original decision. The existing purge_expired_telemetry scheduler must remain active. Seven-day payload/thirty-day diagnostics are bounded defaults, not an indefinite outage SLA.

## Rollback

Prefer hiding management APIs/UI while keeping the adapter-aware worker/schema to drain accepted work. Pause affected destinations if dispatch must stop; retention still runs. Do not drop tables or erase queues to make old code start.

Disabling the integration database flag stops new integration fanout but does not remove existing jobs. **Never start an old dispatcher while managed jobs remain eligible.** Repair forward or deliberately pause/cancel affected work through audited operations. Existing legacy webhooks continue through the adapter-aware worker. Rollback cannot retract a cloud message already accepted; keep event IDs and downstream deduplication.

## Provider and networking prerequisites

Public verified-TLS endpoints only. Private databases, metadata addresses, arbitrary cloud endpoints, redirects, SQL/DSN input and executable mappings are unsupported. Commercial AWS regions only. Minimum permissions are documented in `/docs/integrations*`: SQS lookup requires GetQueueAttributes; EventBridge also needs DescribeEventBus; Google read verification needs topics.get in addition to publish. HTTP/Azure send-only checks validate configuration rather than live access.

Live cloud interoperability, hosted Supabase/PostgREST authorization, actual PM2 environment and sustained multi-host capacity remain staging prerequisites.
