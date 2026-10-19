# Staged deployment and rollback

**These commands are instructions, not actions already performed. Migration 035, the delivery worker and the new UI have not been deployed.** No live devices need new firmware. Existing Secure V2 packet and receipt sizes stay unchanged. The completed Phase 1/2 deployment is separate.

## Prerequisites and review

1. Review migration 035 in staging with a backup and staging-only credentials. Verify the deployed schema includes 034 and the required 022/026/033 definitions. Do not blindly run a migration push against an unknown history; Phase 1/2's production history version is recorded in its rollout evidence.
2. Confirm actual gateway/PM2 process names and working directories with the operator. The repository previously contained no production PM2 configuration, so this change does not invent its current process layout.
3. Review seven-day payload/thirty-day metadata retention, eight-attempt/24-hour retry cycles, three manual cycles and the operational 100,000 pending-work ceiling. These are bounded defaults, not a new subscription tier or public SLA. Assess actual write volume/storage and tune service settings only after measurement.
4. Confirm only trusted worker/gateway processes possess the service role key. The frontend continues using member/writer-authorized RPCs. Keep private environment files outside Git, public assets and logs.
5. Inspect existing pending work and destination settings. No automatic replay/backfill of historical telemetry is installed. Existing jobs retain their original age; expired jobs can become terminal under the explicit policy.
6. Verify the existing scheduled `purge_expired_telemetry` job is active. Migration 035 replaces its function but does not install a separate scheduler. Replay eligibility expires by timestamp even before cleanup; actual payload/metadata removal depends on successful retention sweeps and should be monitored.

## Rollout order

### 1. Additive database schema

Apply `supabase/migrations/035_reliable_delivery.sql` in a single migration transaction, using your normal reviewed Supabase migration mechanism. For a disposable direct PostgreSQL connection, the equivalent is:

```sh
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/035_reliable_delivery.sql
```

Do not copy a production connection secret into a shared command log. Migration 035 defaults `delivery_pipeline_settings.enabled=false`. There is no worker deployment or old-event resend in the migration. The existing worker RPC remains available before activation. New retention behavior and event metadata apply as soon as this schema is installed; this is why even the additive step requires review.

### 2. Gateway and worker code

Install the reviewed code and normal production dependencies. Set `OUTBOX_EMBEDDED=false` in the gateway's private environment before starting a separate worker. Restart only the operator-identified gateway process through its established deployment procedure. Its ingestion path remains compatible with current firmware.

Stop old embedded/standalone dispatchers and let their in-flight requests drain before activation. Already-claimed legacy jobs can finish through the compatibility RPC; the new completion fence still requires their lease to be valid.

### 3. Explicit database activation

After the new worker is ready to start and old dispatchers are drained, an operator performs:

```sql
update public.delivery_pipeline_settings set enabled=true where id=true;
```

Old claim RPCs now fail closed with `UPGRADE_DELIVERY_WORKER`. Queued work remains durable during the brief worker handover. Ingestion never waits for webhook dispatch. New workers require both the database flag and `STRUCT_DELIVERY_PIPELINE_V2=true`.

### 4. Standalone worker

From the repository root on Struct's existing server:

```sh
npm --prefix tcp-server ci --omit=dev
pm2 start tcp-server/ecosystem.delivery.config.cjs
pm2 logs struct-delivery --lines 100
curl --fail http://127.0.0.1:9092/health
```

The template sets its working directory to `tcp-server`. Its private environment must already supply `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (existing naming, never public). It uses one process, eight local slots, one-second idle polling, a loopback-only health port and a 35-second graceful-stop allowance. Database requests have a ten-second deadline and webhook requests eight seconds. PM2 can still kill a stuck process; the 60-second leases recover claimed jobs. Verify memory under real load before accepting the template's 256 MiB restart threshold.

Direct operation without PM2 is also supported:

```sh
cd tcp-server
STRUCT_DELIVERY_PIPELINE_V2=true OUTBOX_HEALTH_PORT=9092 npm run start:worker
npm run delivery:health
```

On PowerShell, set these variables with `$env:NAME='value'` before the command. Environment settings are not credentials except for the existing private database URL/key.

For multiple worker processes, give each a separate loopback health port or set `OUTBOX_HEALTH_PORT=0` and use process monitoring plus `delivery:health`. Do not blindly PM2-scale the single-port template; a port collision deliberately shuts the affected worker down. SQL enforces tenant/destination capacity across workers, independent of local concurrency.

### 5. Observe before enabling UI

Read `npm run delivery:health` from `tcp-server`: verify activation/version, queue depth, oldest pending, expired leases, successes/retries/dead letters and latency. Inspect worker database errors, RSS/CPU and PM2 restarts. Exercise a staging receiver returning 503, then 2xx; verify actual retry and stable signed event/delivery IDs. Confirm ingestion/receipts remain healthy while the worker is stopped.

### 6. Dashboard

Set `NUXT_PUBLIC_DELIVERY_PIPELINE_ENABLED=true` in the web application's deployment environment only after the database/worker are healthy, then build/deploy the reviewed web release using the existing Vercel workflow. With the flag absent/false, the previous delivery interface remains available. The new flag does not itself activate database processing.

Verify a writer can preview/confirm recovery, a viewer cannot mutate, and another workspace cannot read event/attempt history. Check desktop/mobile and actual production hosting/auth behavior with disposable authorized test data; do not benchmark into live customer devices.

## Operational behavior

- Worker stopped: committed outbox work remains; automatic age and payload retention windows still apply.
- Database unavailable: gateway cannot claim a successful commit receipt; worker retries polling with bounded requests. Ambiguous RPC responses can mean a commit happened; existing authenticated retry/dedup rules resolve this.
- Slow/unavailable destination: bounded process/tenant/endpoint concurrency, backoff, Retry-After and terminal policy protect ingestion from synchronous third-party work.
- Backlog cap reached: the ingestion transaction fails instead of falsely acknowledging durable work; existing device retry behavior applies.
- Pause: pending work held, in-flight work may complete. Seven-day payload expiry continues while paused.
- URL changed/disabled/removed: existing work is terminal rather than redirected to a different receiver.
- Payload expired: no replay, even if the event identity is still visible. Metadata is removed after thirty days.

## Rollback

Prefer rolling back the dashboard flag/web release while retaining the new additive schema and worker to process already-accepted work. Do not drop tables, delete queues, reset sequences or remove event IDs.

If dispatch must stop, stop `struct-delivery`; work remains durable within its retention window. Repair forward and resume. Reverting to an old worker requires explicit database deactivation, compatible code review and acceptance of the older retry/observability limitations. Do not simply start an old dispatcher against the activated pipeline. Keep retention cleanup and already-persisted records intact.

No destructive down migration is supplied. An operator must review rollback consequences rather than discarding accepted work to make an older application start.
