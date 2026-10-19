# Phases 5 + 8: monitoring and usage analytics

Implementation date: October 13, 2026. This is a default-off, additive release candidate built on the uncommitted Phase 3/4, 7 and 6 changes in this checkout. It has not been deployed or applied to production.

- [Initial audit](AUDIT.md)
- [Architecture, measurements and limitations](ARCHITECTURE.md)
- [Deployment and rollback](DEPLOYMENT.md)
- [Verification and performance](VERIFICATION.md)
- [Machine-readable local evidence](evidence/qualification.json)

Customer documentation is available at `/docs/monitoring-analytics`. Dashboard routes are `/dashboard/monitoring`, `/dashboard/analytics` and `/dashboard/alerts`. Devices can link directly to monitoring with a device filter; existing device controls remain available.

## Run locally

From the repository root, install the existing root, web and tcp-server dependencies with their lockfiles. Use Node 24 and the existing SDK build prerequisites. No new paid service is required for dashboard incidents or analytics.

```powershell
npm ci
npm --prefix web ci
npm --prefix tcp-server ci
npm run test:observability
npm --prefix web run typecheck
npm --prefix web run dev
```

For a disposable local Supabase project, apply migrations through 038, set private gateway credentials using the existing development configuration, explicitly enable `observability_settings.enabled`, and set `STRUCT_OBSERVABILITY_ENABLED=true` in the gateway, web server and worker environments. Set `NUXT_PUBLIC_OBSERVABILITY_ENABLED=true` before starting/building the website. Never point local fault tests at a hosted customer database. `npm run start:observability` runs the worker; its service credentials must stay server-side.

For the reproducible browser fixture, build the site, then run two separate shells from the root:

```powershell
# Shell 1: in-memory PostgreSQL-engine fixture, loopback port 3125
$env:STRUCT_OBSERVABILITY_FIXTURE='true'
$env:STRUCT_OBSERVABILITY_ENABLED='true'
node tests/fleet/http-fixture.cjs
```

```powershell
# Shell 2: locally built Nuxt preview, loopback port 3120
$env:PORT='3120'; $env:HOST='127.0.0.1'
$env:NUXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:3125'
$env:NUXT_PUBLIC_SUPABASE_KEY='local-anon-key'
$env:NUXT_SUPABASE_SERVICE_KEY='local-service-key'
$env:NUXT_SUPABASE_SECRET_KEY='local-service-key'
$env:STRUCT_FLEET_ENABLED='true'; $env:NUXT_PUBLIC_FLEET_ENABLED='true'
$env:STRUCT_OBSERVABILITY_ENABLED='true'; $env:NUXT_PUBLIC_OBSERVABILITY_ENABLED='true'
$env:STRUCT_SECURE_V2_ENABLED='true'
$env:TCP_CREDENTIAL_KEY=('34' * 32) # disposable fixture key only
node web/.output/server/index.mjs
```

Then run `npm --prefix web run test:observability:browser`. The fixture supplies simulated authentication; the browser exercises real Nuxt handlers, SQL migrations, RLS, aggregation and evaluation. It seeds a real AEAD reading and clearly synthetic activity fixtures. It is not hosted Supabase authentication or a physical fleet.

## Tests and measurements

```powershell
npm run test:observability
npm --prefix web test -- --maxWorkers=1
npm run test:pipelines
npm run test:integrations
npm run test:fleet
npm run test:secure-v2
npm run benchmark:observability
npm run benchmark:observability:scale
npm run benchmark:observability:gateway
node tests/observability/collect-evidence.cjs
# Optional bounded 100,000-record synthetic inventory qualification:
$env:STRUCT_OBSERVABILITY_SCALE_MAX='100000'
npm run benchmark:observability:scale
```

The PostgreSQL benchmark reuses the local PostgreSQL tools described in the Phase 3/4 test setup under ignored `work/pipelines/postgres-tools`. It creates a random loopback-only cluster, terminates a disposable backend for fault injection and removes only its verified temporary directory. Scale tests use PGlite and synthetic inventories; they do not register production devices. ESP32 builds require the repository's PlatformIO toolchains; full C/WASI security parity requires its existing Zig/mbedTLS test prerequisites. Review the verification report for exact tested boundaries and remaining qualification work.
