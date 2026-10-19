# Verification and remaining coverage

All activity used disposable credentials, local services and isolated data. No production database, devices, gateway, Stripe, cloud resource or deployment was modified. Evidence JSON/screenshots are in `evidence/`; environment/source hashes are in its manifest.

## Actual verification

| Suite | Result | Boundary |
|---|---:|---|
| integrations/core.cjs | 44 assertions passed | Validation, AES-GCM tenant/destination AAD, precision, SSRF policy and safe errors |
| integrations/database.cjs | 47 assertions passed | Actual migrations in PGlite; real Secure V2 ingestion, atomic fanout/dedup, rules, versions, tenant roles, mapping recovery and receipt transaction |
| integrations/contracts.cjs | 39 assertions passed | Real local HTTP, official AWS SDK encoding/signing, independently verified JWT/SAS, provider errors and shared-worker recovery |
| integrations/postgres.cjs | 12 assertions passed | Actual PostgreSQL 18.4/TLS 1.3; twenty concurrent duplicate inserts, precision, hostile values and certificate rejection |
| integrations/load.cjs | 5 assertions passed | Four tenants, 80 Secure V2 readings, 240 jobs, two worker loops, healthy/slow/recovering receivers |
| Web Vitest excluding secureV2Project.test.ts | 188 tests / 37 files passed | Existing features plus four integration API fixture tests |
| Web type checking | Passed | Nuxt/TypeScript |
| Production build | Passed; final evidence manifest | Server build, provider dependencies server-only |
| Integration Playwright | Count in evidence/browser.json | Desktop/tablet/mobile, real rendering/auth fixture and mocked integration API responses |

Existing pipeline regressions also passed: 50 database, 18 recovery-safety, 57 policy/security and eight startup assertions; worker-fault scenarios exercise separate processes, worker termination and database unavailability. pipelines/postgres.cjs passed 17 actual PostgreSQL multi-backend/lease/crash checks with migration 036. Gateway package and Secure V2 database/SDK/UDP regressions passed. These validate the shared scheduler/protocol, rather than every cloud process failure against a live provider.

Four unchanged generated ESP32 PlatformIO compilation tests were excluded from the broad Vitest run. No physical board was tested. No authenticated AWS/Azure/Google service was contacted. Provider contract receivers are not managed cloud emulators or IAM verification. Hosted Supabase/PostgREST end-to-end behavior still needs staging; SQL role tests and API fixture tests cover separate boundaries.

## Measured performance

performance.json preserves 1000 timing observations per case using 1000 distinct simulated device IDs. It compares 035 unconditional webhook fanout with 036 actual decimal routing/snapshots in sequential PGlite SQL commit-stage inserts. Packet networking, crypto, provider latency and production database concurrency are excluded. performance-summary.json holds median/p95 results. Routing adds work; this is not a gateway speedup claim.

load.json records dispatch throughput, latency, queue outcomes, CPU and memory. All 240 logical jobs succeed after four transient failures. Two worker loops share one process/PGlite backend; actual multi-backend claim safety is checked separately. Memory includes the embedded WASM database, not just a production worker. Scheduler time is advanced once to exercise recovery without waiting for wall-clock backoff. This is not a fleet-capacity or carrier impairment certification.

## Reproduction

From repo root:

```powershell
npm ci
npm --prefix tcp-server ci
npm --prefix web ci
npm run test:integrations
npm run test:integrations:postgres
npm run test:pipelines
npm run test:pipelines:postgres
npm --prefix tcp-server test
node tests/integrations/load.cjs
node tests/integrations/performance.cjs
npm --prefix web run typecheck
npm --prefix web test -- --exclude shared/secureV2Project.test.ts
npm --prefix web run build
```

Actual PostgreSQL tests require the optional ignored portable runtime. Current Windows setup: `npm install --prefix work/pipelines/postgres-tools --no-save embedded-postgres@18.4.0-beta.17 pg@8.23.1`. TLS tests use Git OpenSSL at `C:\Program Files\Git\usr\bin\openssl.exe`; set STRUCT_TEST_OPENSSL for another installed binary. Disposable cleanup validates the parent directory. Generalize runtime paths before assuming another OS works. Missing optional tools are a blocker for that suite, not a pass.

Browser reproduction in separate local terminals:

1. `npm run test:phase12:fixture` starts disposable auth/database responses on loopback 3105.
2. Set SUPABASE_URL and NUXT_PUBLIC_SUPABASE_URL to http://127.0.0.1:3105; SUPABASE_KEY and NUXT_PUBLIC_SUPABASE_KEY to local-anon; SUPABASE_SERVICE_KEY to local-service; public integration/delivery flags and private integration flag to true; STRUCT_INTEGRATION_KEY to a disposable 64-hex value. Never use production credentials.
3. Build with this environment, then `node web/.output/server/index.mjs` with HOST=127.0.0.1 and PORT=3110.
4. `npm --prefix web run test:integrations:browser`. Install Playwright Chromium if absent. Stop the owned preview before rebuilding, to avoid cached HTML referencing removed assets.

Ordinary development uses disposable staging Supabase with reviewed migrations and `npm --prefix web run dev`. The browser fixture does not implement real integration database APIs; tests deliberately mock those responses.

## Remaining acceptance work

Implemented locally; **not every production acceptance criterion is verified**.

- Live IAM/authentication, provider TLS/quotas/regional errors and hosted acknowledgments remain unverified.
- No AWS role assumption/automatic session refresh, Azure Entra/managed identity, Google workload identity, private connectivity or encryption-key ring. Provider credentials can be replaced; encryption-key rotation needs controlled rewrap.
- No native provider batching, FIFO throughput optimization, extra Kinesis/S3/Event Hubs/Kafka connectors, rule priority/catalog, tags/groups or arbitrary PostgreSQL column mappings.
- Pub/Sub requests a token for each attempt; EventBridge checks bus existence before publication. Load-test these extra requests before high-volume rollout. Token caching remains future work.
- One bounded rule tree per destination; decisions/configuration remain frozen. Explicit recovery can replace only the mapping. Replay never discovers new targets.
- Generic synthetic tests may fail required application-field mappings. No-send sample previews validate mappings; real telemetry after deliberate enabling provides final delivery proof.
- Health uses existing backlog, recent failures, last-success and attempt metrics. Dedicated consecutive-failure alarms/provider billing dashboards are outside Phase 7.
- Private customer databases need a separately authorized connectivity design.
- Seven-day payload/thirty-day metadata cleanup depends on the existing scheduler; no indefinite delivery SLA. Queue caps reject commits explicitly rather than silently lose work.
- Browser workflows use API fixtures; hosted end-to-end, physical hardware and cloud interoperability remain unverified.

Limitations are documented rather than represented by placeholder success states.
