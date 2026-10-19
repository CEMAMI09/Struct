# Verification, measurements and remaining qualifications

Tests run on a Windows host with Node v24.18.1. No live devices, Supabase records, Stripe data or production gateway processes were used. Test credentials are generated or explicit local fixtures. Raw evidence contains safe IDs/metrics, not production secrets.

## Correctness and security

| Suite | Result / boundary |
| --- | --- |
| `tests/pipelines/database.cjs` | 50 checks passed: real gateway crypto/receipt, atomic rollback, duplicates, batch identity, claim-time attempts, stale fencing, 503 Retry-After, 401 dead letter, pause/recovery, retention and RLS. PGlite single backend. |
| `tests/pipelines/recovery-safety.cjs` | 18 checks passed: 110 eligible failures select 100, filters/pause exclusion, eight-attempt ceiling, three recovery cycles, cancel, rate limits, writer/viewer/tenant privilege checks, direct attempt-lease token read rejection and old-worker activation guard. |
| `tests/pipelines/policy-security.cjs` | 57 checks passed: response/error classification, Retry-After limits, URL/private/metadata/mapped-IP blocking, mixed DNS answers, pinned lookup, rebinding on later attempts, no redirect following, body/header policy and unauthenticated capture guard. DNS/HTTPS transport injected; not public-internet endpoint qualification. |
| `tests/pipelines/worker-faults.cjs` | Passed actual child workers + loopback HTTP/HMAC: 503/429/401, DNS error injection, real timeout, real refused connection, kills before send/during request/after remote success, RPC outage injection, restart recovery and two-worker dispatch. SQL is single-backend PGlite; retries/lease clocks are advanced in the disposable fixture to avoid long waits. |
| `tests/pipelines/postgres.cjs` | 17 checks passed on real PostgreSQL 18.4 with eight distinct backend processes: concurrent duplicate RPCs, stable event/outbox uniqueness, global claims/capacity, concurrent completions/replays, mixed ingestion/claim locks, multiple tenants, actual database process termination/restart and WAL recovery. Separate local server, no Supabase REST/auth/cron service. |
| `tests/pipelines/worker-startup.cjs` | Actual standalone entry point against an isolated REST fixture: 8 checks passed: activation preflight, no early claim, health/polling, restricted health path, shutdown and hung database deadline. See `evidence/worker-startup.json` for final count and timing. |
| Existing gateway suite | All 13 scripts passed, including UDP/TCP, encryption/authentication, replay, webhooks/outbox and Secure V2. Native parser unavailable; JavaScript fallback explicitly used. |
| Existing DB/auth/billing/delivery/onboarding/debugger and Secure V2 DB suites | Passed. Existing authenticated local UDP debugger tests and generated Node sender tests also passed. |
| Web unit/regression suite | 184 tests in 36 files passed; includes Protocol Lab, auth/billing/onboarding and six new delivery presentation tests. Unchanged PlatformIO firmware compilation suite excluded from this run. |
| Typecheck and production build | Passed after fixing an incomplete typed test fixture and a multi-statement Vue event handler. Final build evidence summarized in `evidence/verification.json`. |
| Browser workflows | Desktop 1440×1000, tablet 820×1180, mobile iPhone viewport; trace, filters/keyset pagination, retry confirmation, bounded bulk selection, viewer permissions, pause, invalid data and guide route. See final `evidence/browser.json`; initial locator failures were investigated and fixed, not hidden. A later local preview also needed restarting after a rebuild replaced its asset manifest; the final run uses the matching build. |

Gateway/worker tests exercise real authenticated encoding/decoding and SQL; browser tests use actual rendered Nuxt pages with isolated authentication and routed data fixtures. They are complementary, not one test spanning a hosted Supabase instance. Physical ESP32 testing was not performed for these phases; no firmware or wire format was changed. Earlier Phase 1/2 build evidence is not relabeled as new hardware testing.

## Actual performance evidence

`performance.cjs` applies migration 034 or 035 to fresh local PGlite instances and measures 100 serial telemetry INSERT transactions after ten warmups, with 0/1/4 destinations. These are host SQL timings, **not network ingestion throughput or production PostgreSQL capacity**. Baseline and after raw measurements are stored separately.

| Destinations | Before median / p95 (ms) | After median / p95 (ms) |
| --- | --- | --- |
| 0 | 0.2865 / 0.4498 | 0.3121 / 0.5247 |
| 1 | 0.3328 / 0.4870 | 0.3815 / 0.5359 |
| 4 | 0.3746 / 0.5620 | 0.5251 / 0.6751 |

The new event/capacity writes add measurable cost. This is expected reliability overhead, not a speed improvement. Serial INSERT rate declined from roughly 2,419 to 1,830/s in the four-destination sample. Small host runs are noisy and cannot establish a production SLO.

A second sequential pair against the final migration is preserved in `baseline-final.json` and `after-final.json` (the first pair is retained). Final medians/p95 were 0.2891/0.7244 → 0.3263/0.5355 ms with no destination, 0.3007/0.4294 → 0.3856/0.4616 ms with one, and 0.3607/0.5139 → 0.5283/0.7453 ms with four. The four-destination serial rate was 2,569 → 1,797/s. The differing zero-destination tail timings illustrate host noise; both pairs show higher median insertion cost. No favorable run was substituted for an unfavorable one.

The real HTTP fault suite dispatched twenty unique readings to a deliberately 100-ms receiver with two processes, approximately 7.8 deliveries/s on this host; per-endpoint concurrency intentionally limits throughput. Gateway host processing median was approximately 1.8 ms, p95 approximately 2.6 ms in that run. See `worker-faults.json` for exact run values, actual child-process RSS/CPU and controller memory. Controller RSS includes the embedded database and must not be described as worker-only memory.

Real PostgreSQL contention/restart timing is reported separately in `postgres.json`; it includes fixture work and is not a throughput benchmark. Production commit latency, database CPU, long sustained backlog growth, real hosted API/network cost, and representative large-fleet capacity remain unmeasured.

## Reproduce browser checks locally

Terminal 1, repository root:

```powershell
npm run test:phase12:fixture
```

Terminal 2, `web/`, using only local fixtures:

```powershell
$env:NUXT_PUBLIC_DELIVERY_PIPELINE_ENABLED='true'
$env:NUXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:3105'
$env:NUXT_PUBLIC_SUPABASE_KEY='local-anon'
$env:SUPABASE_URL='http://127.0.0.1:3105'
$env:SUPABASE_SERVICE_ROLE_KEY='local-service'
$env:STRUCT_SECURE_V2_ENABLED='true'
$env:NITRO_PORT='3108'
$env:NITRO_HOST='127.0.0.1'
npm run build
node .output/server/index.mjs
```

Terminal 3, `web/`:

```powershell
npm run test:pipelines:browser
```

Use Playwright's installed Chromium (install with `npx playwright install chromium` if absent). Auth and delivery responses are disposable fixtures. For manual normal development use `npm run dev` in `web/` with staging/test configuration and the flag enabled; the default retains the legacy delivery UI. Never put production credentials in browser tests.

## Remaining limitations and deployment gate

- Migration 035 and new worker/dashboard are **not live**. Stage them in the documented order and verify the real hosting/auth/service-key boundaries before production rollout.
- Debug captures are opt-in and authenticated; there is no universal persisted packet-arrival/auth/decode timeline for every packet, nor attribution of unauthenticated failures to customer devices.
- Only telemetry gets the transactional outbox guarantee. Connection/disconnection hooks remain best effort. No new AWS/Azure/private-network destination catalog is included.
- Batch recovery is capped at 100 per action with confirmation. It does not enqueue an unlimited time range in one request. There is no arbitrary re-targeting to a new endpoint; current destination identity/URL must match.
- Recovery depends on seven-day payload availability and ends after three manual cycles. There is no indefinite DLQ. Review these policies/storage costs before making contractual reliability claims.
- Existing raw-body signing remains compatible but has no signed timestamp/key-ID freshness contract. Receivers need durable idempotency. A compatible future signature migration is described, not claimed implemented.
- No long soak, internet-scale load, exhaustive gateway process-kill matrix, physical board test, native parser build or hosted Supabase outage test was performed. Real local PostgreSQL process recovery and separate-backend concurrency **were** tested.
- The local worker loopback transport is injected only in tests. Production dispatch still requires public HTTPS; private destinations are deliberately unsupported.
- Default one active request/destination is conservative. Scaling a single hot receiver requires a reviewed policy change and tests, not simply adding worker processes.
- New dashboard data is a refreshable snapshot; it is not advertised as a realtime fleet-monitoring/alerting system.

The implementation is ready for **staging/deployment review**, not an unqualified assertion that every enterprise reliability acceptance item or scale scenario has passed.
