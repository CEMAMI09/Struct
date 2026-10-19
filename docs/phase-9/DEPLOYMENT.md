# Review-only rollout and rollback

**No deployment commands or hosted migrations were executed for this phase.** This checkout contains prior uncommitted delivery/integrations/fleet/observability work. Review that full dependency set before shipping Phase 9; it cannot be deployed as only two UI files.

## Prerequisites and migration order

1. Confirm backups and independent encryption keys are recoverable; inventory current migration versions and exact RPC definitions in a nonproduction replica. Review RLS/privileges, Scale team/audit entitlements and existing member roles.
2. Deploy compatible prerequisites through migrations 035–038 and their application/worker versions according to their phase rollout guides. Do not activate an incomplete dispatch/monitoring system.
3. Apply `039_enterprise_roles.sql` as its **own committed migration/transaction**. PostgreSQL enum additions must commit before 040 uses Developer/Operator. Existing values and devices remain unchanged.
4. Apply additive `040_enterprise_operations.sql`. It adds authorization/audit/team/token/mail/health/recovery structures and guards existing functions without changing their public wire contract. It depends on exact known existing signatures and should fail if prerequisites are missing. The database enterprise flag initially remains false.
5. Deploy the updated web/API/gateway/worker code with customer enterprise interfaces disabled, verify ordinary device creation, schema publication, SDK generation, authenticated receipts, delivery, billing and existing team flows. Device SDK routes now use private transactional RPCs from 040 even before the new UI is activated; migration must precede this code.
6. Configure private environment keys and invitation email only in staging. Start the typed enterprise worker and probes. Test isolated roles/invitations/audit/key flows and recovery before enabling the UI.
7. Explicitly activate database `enterprise_settings.enabled` and server/public flags in the chosen reviewed environment. This switches legacy immediate-add to invitation acceptance. Do not invite customers automatically or activate integrations/notifications for them.
8. Expand after checking authorization failures, database latency, queue recovery, audit growth and readiness freshness. Rollout does not itself establish an SLA or private-cloud product.

New structures include `role_permissions`, `enterprise_settings`, `organization_invitations`, `enterprise_api_keys`, `enterprise_key_usage`, `enterprise_mail_jobs`, `enterprise_mail_attempts`, `enterprise_service_config`, `enterprise_heartbeats`, `enterprise_health_history`, `ingestion_recovery_gate` and added `audit_logs` columns/indexes. New sensitive tables have RLS and no browser grants; service-only APIs return safe projections. `current_org_permission` supports session policies, while arbitrary-actor functions are private. Creator-account deletion is guarded. No existing root/schema/event is regenerated, overwritten, backfilled into membership or automatically redelivered.

## Environment

- Web/API and all instrumented services: `STRUCT_ENTERPRISE_ENABLED=true` only after 040. Web also needs `NUXT_PUBLIC_ENTERPRISE_ENABLED=true` for the new interface. Server flag and database flag are separately required for enterprise requests.
- Existing flags for Secure V2, delivery, integrations, fleet and observability retain their prior meaning. Disabling the enterprise UI does not revoke already-defined database capability guards.
- `STRUCT_APP_URL`: trusted HTTPS origin used to construct invitation links; never derive it from user input. Loopback HTTP is allowed only for local fixture development.
- Existing private Supabase service credentials; browser gets only its proper public Auth URL/key. Do not substitute service keys in public variables.
- Existing `TCP_CREDENTIAL_KEY` encrypts transient invitation mail tokens and device credentials; keep it independently backed up. `STRUCT_INTEGRATION_KEY` remains separate for integration secrets.
- Optional `RESEND_API_KEY` and `STRUCT_ALERT_EMAIL_FROM` use the existing fixed mail transport and a verified sender. Sending requires an explicit checkbox/action; absence does not block manual invitation links.
- Private SDK configuration: `STRUCT_INGEST_HOST`, `STRUCT_INGEST_PORT`, `STRUCT_BOOTSTRAP_ORIGIN`. Bootstrap must use HTTPS with a trusted certificate; no certificate verification bypass is introduced. ESP32 bundled trust roots must match the private certificate authority or be reviewed/rebuilt appropriately. Managed defaults remain `ingest.usestruct.com:8081` and the normal managed HTTPS bootstrap origin.

Do not use fixture keys, tokens, database URLs or test passwords in a real environment. Never commit external private environment files; `.dockerignore` excludes environment/build/research/test artifacts and `.gitignore` excludes the private reference env/secrets directory.

## Worker operation

These commands are provided for review; execute only in the intended staging/approved deployment with private environment injection:

```sh
cd tcp-server
npm ci
node enterprise-worker.js
# Existing PM2 architecture, if used by the deployment:
pm2 start ecosystem.enterprise.config.cjs
pm2 logs struct-enterprise --lines 100
node enterprise/probe.js enterprise
pm2 stop struct-enterprise
```

SIGINT/SIGTERM stops claiming, waits for the in-flight job/heartbeat and leaves uncompleted leases recoverable. The worker owns invitation mail and bounded enterprise retention, not a second telemetry queue. Starting it also enables periodic cleanup of existing audit rows older than 90 days (at most 1000 per pass); review retention obligations and backups before activation. Migration 040 itself does not delete those historical rows. Monitor failed mail counts, current heartbeat and private process errors. Logs contain safe counters/correlation, not recipient tokens or exception payloads. Database/API timeouts and retry limits remain bounded. Use existing separate delivery/fleet/observability PM2 files; `OUTBOX_EMBEDDED=false` prevents intentionally running an additional embedded dispatcher.

## Private deployment reference

`deployment/enterprise/Dockerfile`, `compose.yaml` and `private.env.example` describe Node gateway plus typed workers. A separately provisioned Supabase-compatible database/Auth/REST and web/API/bootstrap application, ingress/DNS/TLS, secret manager, object backup and outbound destination security are required. Containers run as nonroot, use read-only filesystems/tmpfs, drop capabilities and default ingress bindings to loopback.

Review-only invocation:

```sh
export STRUCT_PRIVATE_ENV_FILE=/secure/path/struct-private.env
docker compose -f deployment/enterprise/compose.yaml config
docker compose -f deployment/enterprise/compose.yaml build
docker compose -f deployment/enterprise/compose.yaml up -d
```

This is **not a complete verified self-hosted Supabase bundle**. Docker is unavailable in the qualification environment; images/Compose, private TLS/CA setup, cloud networking, mail and managed failover have not been executed. The locally verified reference is actual Node SDK → UDP gateway → disposable PostgreSQL, with restart/counter persistence and recovery quarantine. Dedicated managed/private cloud/customer-managed modes require environment-specific operational qualification before being advertised as production-ready. No Helm chart, Terraform cloud provisioning or paid infrastructure is included.

## Rollback

Disable new UI/server enterprise entry points and stop the invitation worker if necessary. Keep 039/040 tables, enum values, audit rows, invitations and queued work; **do not down-migrate by deleting records or removing enum values**. Capability guards and stable private functions should remain in place. Old immediate-add is available only with database enterprise activation off and proper administrative permission; review whether re-enabling that older lifecycle is acceptable.

If rolling back a web release, verify it does not misclassify Developer/Operator or redisclose credentials. Prefer a forward compatibility fix or disable affected writes. Keep compatible workers processing existing telemetry delivery work according to its original durable snapshots. Never reset device sequence counters, erase replay state, change Secure V2 formatting or delete queued events as a rollback. Database restoration uses the quarantine/reprovisioning runbook, not ordinary app rollback.

Health checks for review: direct dashboard auth, owner/member isolation, Developer SDK behavior, Operator retry/ack restrictions, invitation verified recipient, token revoke/remove, audited export, unknown stale heartbeat, normal Secure V2 commit/outbox, preserved old device/schema compatibility and a controlled backup drill. Hosted migration execution, external mail and cloud operation remain explicit release prerequisites.
