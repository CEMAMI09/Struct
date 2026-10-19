# Phases 3 and 4: delivery observability and reliable pipelines

Implemented locally on top of `27be12d`. **Migration 035 is unapplied, the database activation flag defaults off, and the new dashboard defaults off.** No live telemetry, subscriptions, credentials, gateways or PM2 processes were changed for these phases. The earlier Phase 1/2 migration and deployment are recorded separately in [../phase-1-2/ROLLOUT.md](../phase-1-2/ROLLOUT.md).

Start with [AUDIT.md](AUDIT.md) for the verified original failure modes, [ARCHITECTURE.md](ARCHITECTURE.md) for the implementation, [DEPLOYMENT.md](DEPLOYMENT.md) for staged rollout, and [VERIFICATION.md](VERIFICATION.md) for actual results and limitations. Raw compact evidence is in [evidence/](evidence/).

## Implemented

- Extended the existing atomic telemetry/outbox transaction rather than adding a second dispatch system. Stable reading UUIDs, Secure V2 replay rules, batch identities, existing SDKs and the authenticated 21-byte commit receipt are preserved.
- Durable event metadata, claim-time attempts, lease expiry recovery, token/time fencing, tenant fairness and destination pacing. Independent HTTP attempts run outside ingestion.
- Failure-specific retries, Retry-After, bounded jitter/backoff, eight-attempt/24-hour automatic cycles and recorded dead letters. Worker/database outages leave durable work for recovery.
- Writer-authorized retry/replay/cancel and destination pause/resume, request UUID idempotency, audit history, confirmation and bounded bulk recovery across filtered history.
- Server-filtered, keyset-paginated history; queue summary; destination health; event timeline; response/error/retry detail; links from authenticated packet captures. Missing evidence is identified explicitly.
- Independent seven-day recovery payload retention and thirty-day metadata/attempt retention. Expired work becomes an explained terminal record instead of disappearing during normal telemetry retention.
- Operational backlog ceiling, bounded request/response handling, retained public-HTTPS/DNS pinning/no-redirect protections, worker health/metrics and an operator queue-health command.
- An authentication guard fix: failed authentication can no longer attach a forged device claim to that device's customer-visible packet capture.
- Product documentation at `/docs/delivery` and portable local correctness, fault, security, browser and real PostgreSQL concurrency tests.

## Guarantees and limits

Device confirmation means the ingestion transaction succeeded, including eligible delivery intent. It does **not** mean a customer's webhook succeeded. HTTP 2xx means the receiver responded successfully, not that every subsequent business operation completed. Downstream attempts are at least once within the bounded policy; receivers must deduplicate the signed event body's `id` transactionally.

A worker can crash after a receiver processed a request and before PostgreSQL records success. Local fault tests reproduced this and verified the repeat retains its original event/delivery identities. Manual replay also retains those identities and needs an intentional receiver reprocessing policy.

Connection/disconnection hooks remain best effort. Historical samples are not automatically redelivered or reconstructed. Permanent failures require intervention. Payload expiry prevents later replay. No universal exactly-once, indefinite retention, enterprise SLA or large-fleet capacity claim is made.

## Important files

| Layer | Files |
| --- | --- |
| Database | `supabase/migrations/035_reliable_delivery.sql` |
| Dispatch and policy | `tcp-server/outbox.js`, `delivery-policy.js`, `safeWebhook.js` |
| Worker and operation | `tcp-server/worker.js`, `delivery-health.js`, `ecosystem.delivery.config.cjs` |
| Gateway trace integration | `tcp-server/secure-v2.js`, `trace.js` |
| Dashboard | `web/app/pages/dashboard/deliveries.vue`, `web/app/components/DeliveryEventTrace.vue`, `LegacyDeliveryHistory.vue` |
| Shared models and documentation | `web/shared/delivery.ts`, `delivery.test.ts`, `documentation.ts` |
| Flags and RPC types | `web/nuxt.config.ts`, `web/app/types/database.types.ts` |
| Local tests | `tests/pipelines/`, `web/test/pipelines/`, `web/playwright.pipeline.config.ts` |

## Quick reproduction

From the repository root:

```powershell
npm ci
npm --prefix tcp-server ci
npm --prefix web ci
npm run test:pipelines
npm --prefix web run typecheck
npm --prefix web test -- --exclude shared/secureV2Project.test.ts
npm --prefix web run build
```

The excluded test compiles embedded firmware and is unchanged by this feature. Run it separately when its ESP32/PlatformIO toolchains are available. No physical-board testing was performed for Phases 3/4.

Optional real PostgreSQL qualification installs test-only tools under ignored `work/`:

```powershell
npm install --prefix work/pipelines/postgres-tools --no-audit --no-fund embedded-postgres@18.4.0-beta.17 pg@8.23.1
node tests/pipelines/postgres.cjs
```

It starts a disposable cluster bound to `127.0.0.1` on a free port using generated credentials, runs real separate-backend transactions and database restart recovery, stops its own process and verifies its cleanup path before removing only that disposable cluster. The [upstream package](https://github.com/leinelissen/embedded-postgres) supplies platform-specific PostgreSQL binaries; no system service or production package dependency is installed.

Browser reproduction and deployment prerequisites are detailed in [VERIFICATION.md](VERIFICATION.md) and [DEPLOYMENT.md](DEPLOYMENT.md).
