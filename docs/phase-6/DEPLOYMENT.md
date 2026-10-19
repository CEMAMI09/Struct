# Phase 6 rollout — review only

No commands in this guide have been executed against production. Do not apply migrations, restart gateways or start production workers merely by running the local tests.

## Prerequisites

- Review existing uncommitted Phase 3/4 and Phase 7 changes separately. Migration 037 depends on migrations through **036_backend_integrations.sql**, including durable delivery 035 and the existing Secure V2/onboarding migrations. Deploying only the fleet UI is insufficient.
- Back up the target database and inspect existing RLS/grants, trigger definitions and device usage accounting in staging. Migration 037 is additive but wraps the existing ingest/bootstrap/enrollment RPCs; test the complete migration chain on a copy before rollout. No existing credentials are regenerated.
- Node 22+ and the existing `tcp-server` dependencies; no new paid service is needed. The web session, Supabase service-role key and existing `TCP_CREDENTIAL_KEY` must be configured privately. Never replace that key with a test key: it must decrypt existing device credentials.
- Review result retention, soft-archive billing behavior, manual reprovisioning warnings and manufacturing-manifest handling before activation.

## Ordered rollout

1. Apply reviewed additive migration 037 through the normal migration process, after 035/036. `fleet_settings.enabled` defaults to false. Existing device rows default to enabled. Wrappers preserve the original wire/replay/commit implementation; current-epoch provisioning evidence is backfilled only from durable packet records.
2. Deploy the compatible gateway code (`ingest.js`, `secure-v2.js`) and web APIs with `STRUCT_FLEET_ENABLED=false`. Keep the fleet UI disabled. No live device or PM2 operation is performed by this task.
3. In a separately approved maintenance step, enable the database setting:

   ```sql
   update public.fleet_settings set enabled=true where id=true;
   ```

4. Configure the fleet worker with private `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, the existing 64-hex-character `TCP_CREDENTIAL_KEY`, and `STRUCT_FLEET_ENABLED=true`. The worker refuses startup without both flags and required credentials. Keep secrets out of the PM2 template/Git.

   ```powershell
   cd tcp-server
   npm ci
   node fleet-worker.js
   # Alternative managed process, after reviewing the template:
   pm2 start ecosystem.fleet.config.cjs --only struct-fleet
   pm2 logs struct-fleet
   pm2 describe struct-fleet
   ```

   Start with one worker. The template bounds memory at 256 MiB and permits 20 seconds for graceful shutdown. Do not run `pm2 save` until the process and environment are verified. Multiple workers use leases/fencing, but hosted throughput requires separate measurement.

5. Set web `STRUCT_FLEET_ENABLED=true` and `NUXT_PUBLIC_FLEET_ENABLED=true`, rebuild and deploy the reviewed application. The public flag only chooses UI; it cannot authorize API access. Verify owner/admin and viewer behavior with disposable staging accounts.
6. Create one device, copy an authorized schema, confirm the job, securely download a test manifest, send a packet through the staging gateway, disable and re-enable, then test manual reprovisioning. Confirm old credentials fail, new credentials commit, and a group/tag routing change affects only future events.
7. Expand to 100/1,000-device staging jobs while observing gateway commit latency and delivery backlog. Compare hosted measurements with the local evidence before accepting manufacturing-scale throughput targets.

## Health, recovery and retention

Worker logs emit only processed/error counts and last successful database poll every 30 seconds. A successful poll does not prove a physical device was provisioned. Inspect real job counts:

```sql
select organization_id,status,count(*) from public.fleet_jobs group by 1,2;
select job_id,status,count(*) from public.fleet_job_items group by 1,2;
select job_id,item_index,claims,lease_until,error_code
from public.fleet_job_items where status='running' or error_code is not null;
```

Run these only through authorized operator tooling; do not expose service-role queue data publicly. Watch growing pending age, stale leases, repeated worker errors, storage and ingestion latency. After restart, leases expire in 60 seconds and are fenced; no manual reset of counters or credentials is necessary. Three abandoned claims become visible failures. Users can review and confirm eligible-failure retries; automatic retry never repeats successful items.

Cleanup is called periodically by the worker. An operator may explicitly run `select public.fleet_cleanup();` under the documented retention policy. Export reports before 30 days or the 50-terminal-job cap. No raw CSV or plaintext credential archive is retained. Monitor storage for pending jobs if workers remain offline.

## Rollback

Disable the fleet UI first, then stop accepting new jobs. Cancel only explicitly selected jobs when intended; committed changes are not undone. Stop the fleet worker gracefully. Retain migration 037, job records, credential epochs and lifecycle enforcement. **Do not restore an old gateway/database combination that ignores disabled/revoked state**, drop new tables, delete unfinished jobs, reset replay counters or revive revoked keys.

After fleet activation, retain `STRUCT_FLEET_ENABLED=true` on the compatible API release even when hiding the UI. Stop new work with the database setting below. This keeps the legacy hard-delete endpoint blocked; simply switching the server flag off restores that pre-fleet endpoint's compatibility behavior and is not the documented rollback procedure. The public UI flag may be disabled independently.

When temporarily setting `fleet_settings.enabled=false`, claims stop and new fleet actions are denied; persisted pending work remains for recovery. The lifecycle wrappers continue to protect disabled/revoked devices. Re-enable the compatible code/settings and restart the worker to resume. Reverting a manually reprovisioned device requires another deliberate enrollment and firmware update, not resurrecting old secrets.
