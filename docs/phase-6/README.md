# Phase 6 — fleet management

Implemented in the existing Nuxt dashboard, PostgreSQL/Supabase and Node gateway. Default off; no production deployment or data changes performed.

- [Audit](AUDIT.md): original bottlenecks and security boundaries.
- [Architecture](ARCHITECTURE.md): inventory, organization, jobs, provisioning, lifecycle and routing.
- [Deployment and rollback](DEPLOYMENT.md): migration/flags, worker operation and recovery.
- [Verification](VERIFICATION.md): actual test outcomes, evidence and remaining limitations.
- [Evidence](evidence/): local PostgreSQL concurrency, fleet measurements and browser screenshots.

## Local verification

From the repository root (existing dependencies installed):

```powershell
npm run test:fleet
npm run test:fleet:postgres
npm run benchmark:fleet
npm run benchmark:fleet:qualification
npm run benchmark:fleet:ingestion
npm run test:pipelines
npm run test:integrations
npm --prefix web run typecheck
npm --prefix web test -- --maxWorkers=2
npm --prefix web run build
```

The PostgreSQL qualification uses isolated tools under `work/pipelines/postgres-tools` (`embedded-postgres` and `pg`), starts a disposable loopback cluster and cleans only its verified test directory. Install these tools there if absent; they are not production dependencies. `test:fleet` uses PGlite without Docker. Performance scripts create disposable records only. The qualification script enrolls 9,999 new Secure V2 records and can take several minutes. Do not point fixtures at a real Supabase project.

`benchmark:fleet:ingestion` uses the same disposable PostgreSQL tooling to compare migration 036 with 037, including concurrent enrollment. It measures SQL commit transactions and durable outbox records, not production network throughput. The full existing `npm run test:secure-v2` also needs an independent C compiler and upstream mbedTLS source. This run used isolated Zig 0.15.2 and mbedTLS 3.6.7 under ignored `work/`; set `STRUCT_ZIG_COMPILER` and `STRUCT_MBEDTLS_SOURCE` to their local paths. The installed Windows ESP32-C3 toolchain additionally needed its `riscv32-esp-elf/bin` directory prepended to the test process's PATH. Neither change modifies global environment settings.

## Local browser application

Terminal A, repository root:

```powershell
npm run test:fleet:fixture
```

Terminal B, repository root, set **disposable local-only** values:

```powershell
$env:NUXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:3125'
$env:NUXT_PUBLIC_SUPABASE_KEY='local-anon-key'
$env:NUXT_SUPABASE_SERVICE_KEY='local-service-key'
$env:NUXT_SUPABASE_SECRET_KEY='local-service-key'
$env:STRUCT_FLEET_ENABLED='true'
$env:NUXT_PUBLIC_FLEET_ENABLED='true'
$env:STRUCT_SECURE_V2_ENABLED='true'
$env:TCP_CREDENTIAL_KEY='34'*32
$env:PORT='3120'
$env:HOST='127.0.0.1'
node web/.output/server/index.mjs
```

Visit `http://127.0.0.1:3120/login?redirect=%2Fdashboard%2Fdevices`, sign in as `local@example.invalid` with any nonempty fixture password, then open Devices. This fixture simulates authentication only: real Nuxt APIs, migration SQL, RLS, Secure V2 enrollment and the background worker execute locally. It is **not** a substitute for staging Supabase Auth verification. Keep both listeners on loopback.

Terminal C:

```powershell
npm --prefix web run test:fleet:browser
```

A fresh fixture avoids preview/export rate limits during repeated browser runs. Stop only the local test processes you started when finished. To extend coverage, add SQL/worker assertions under `tests/fleet`, shared/API cases beside the TypeScript modules, and actual browser stories under `web/test/fleet`. Never use production devices or credentials in these tests.

Customer guides are published through the existing documentation registry: `/docs/fleet-management`, `/docs/fleet-csv`, `/docs/fleet-provisioning`, `/docs/fleet-api`.
