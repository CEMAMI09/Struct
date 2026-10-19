# Phase 9 verification record

Local qualification on October 16, 2026. No production database/migration, customer device, private cloud, real recipient email or production PM2 process was accessed or modified. Changes are uncommitted on top of the pre-existing multi-phase working tree. See `evidence/verification.json` for source/log hashes and `evidence/` for the actual measurements and rendered screenshots.

## Passed

- `npm run test:enterprise`: **109 checks** — 43 permissions/invitations/key/audit/retention/grant/ingestion checks; 28 actual authorization/RLS/individual SDK/legacy provisioning/operator recovery checks; 29 invitation transport/retry/management job/health checks; nine real local SDK→UDP→database/restart/recovery-gate checks.
- `npm run test:enterprise:postgres`: **14 checks** using actual PostgreSQL 18.4, including simultaneous owner removals, cold copy/restore, retained replay/outbox, independent key recovery, quarantine, old epoch rejection and new epoch authenticated receipt.
- `npm --prefix web run test:enterprise:browser`: **12 passed** across desktop, tablet and mobile. Actual rendered flows cover invitation creation → private fragment handling → sign-in → verified recipient acceptance → audit search/export; one-time API credential → actual inventory → revocation → rejected reuse; sanitized support download; workspace creation/rename → last-owner refusal → switching → no cross-workspace key data; Developer/Operator/Viewer administrative and foreign-tenant denial. Keyboard form submission and no uncaught page errors are checked. Screenshots were visually inspected. Authentication is a local fixture, not live Supabase verification/deliverability qualification.
- Targeted final web unit/route checks: **33 passed** for enterprise helpers, role/redirect/private SDK settings and real transactional SDK route/database behavior. This includes exact PostgreSQL bytea representation at invitation/token HTTP boundaries and a port-only private SDK override.
- Existing `test:pipelines`: 50 database/gateway checks, 18 recovery checks, 57 policy/SSRF checks, eight startup checks, plus the worker crash/outage/two-process/real HTTP signing suite. Existing unauthorized-recovery expectations were updated to the centralized `PERMISSION_DENIED` contract; authorization assertions remain in place.
- Existing `test:integrations`: **130 checks** (44 validation/transformation/security, 47 database/routing/retry/tenant, 39 local provider contracts). Live-cloud interoperability is not inferred.
- Existing `test:fleet`: **113 checks** across database, tenant/security/routing, operations/recovery, worker credentials and actual local UDP/SDK ingestion.
- Existing `test:observability`: **102 checks**, including real packet accounting, Float64/wide integers, alerts, notification retries/preferences, failure recovery and tenant isolation.
- Existing `test:secure-v2`: enrollment/immutable slots/bootstrap/replay/batches/outbox/rotation/retention/grants; packed C WASI parity; Node tampering/counters/UDP IPv4+IPv6/receipt verification; independent C/mbedTLS seven-vector/crypto/persistence/rotation/retry/batch checks. These are host/compiler/loopback tests, not physical hardware tests.
- Existing TCP gateway suite, base database/auth security/billing/onboarding suites passed. Billing fixture now supplies the real owner membership required by transactionally authorized administrative provisioning.
- Final Nuxt type checking and production build passed. The server output is approximately **17.7 MB / 6.68 MB gzip** for the entire accumulated application; no pre-Phase-9 bundle delta is claimed. `git diff --check` passed; only Git line-ending notices were observed.

## Failed / environment-blocked

The full web run produced **249 passed, two failed** (46 passing files, one failing file). Both failures are real generated ESP32-C3/ESP32 PlatformIO bootloader builds: Windows organization's **Device Guard blocked `esptool.exe`, error 4551**. The policy was not bypassed and tests were not relabeled/skipped to obtain a green suite. Generated SDK/main source compilation was reached, but a complete firmware image build cannot be claimed. Physical upload/device testing was unavailable. Repeat these two tests on an authorized build host before release.

Earlier real failures found during this task were fixed: outdated SDK-route fixtures, stale expected denial text, an overescaped PostgreSQL hash at the HTTP boundary and local REST fixture representation of bytea/composite return values. Final targeted routes and browser tests pass after those corrections. Local mocks are explicitly limited to the Auth/PostgREST/provider boundaries; they do not replace SQL or real packet processing.

## Measured performance

`tests/enterprise/performance.cjs` compares migration 038 against 039/040 with enterprise instrumentation enabled in the same local PGlite process. It uses a synthetic **10,000-device inventory**, 20,004 retained synthetic/administrative audit rows, teams of **1/3/20/100**, and **200 actual authenticated Secure V2 single-reading packets per stage** after warm-up. Raw timings, p95s, response sizes, CPU samples and migration hashes are in `evidence/performance.json`. The separately recorded preimplementation small/empty-table baseline is preserved in `evidence/baseline.json`; it is not substituted for the populated comparison.

Observed medians, before → after:

- 100-member authorization lookup: **0.112 → 0.114 ms**.
- 50-device inventory page over 10,000 devices: **21.05 → 21.56 ms**.
- 50-row telemetry page: **0.331 → 0.360 ms**.
- Same 50-row audit projection: **2.434 → 2.477 ms**.
- Actual AEAD/frame/database processing: **1.876 → 1.950 ms**, about **0.074 ms higher** in this local run; sequential throughput **515 → 490 packets/s**. This does not establish a production slowdown or capacity ceiling; it also does not justify claiming zero overhead.

New richer endpoints: team overview with a 50-member page **0.973 ms**, safe 50-event audit projection **8.688 ms**, operations overview **0.376 ms**. The audit projection includes more metadata/redaction than the narrow old query and should not be portrayed as an equivalent-speed replacement. Request-local authorization tests show repeated capability checks share one session/membership lookup; no cross-request cache delays revocation.

End-of-run RSS was about **485 MB for Node plus the embedded PostgreSQL/WASM engine**. It is not gateway-only, worker-only or browser memory. Database server CPU, hosted Auth/PostgREST latency, network tails, browser before/after timing, multi-zone operation and production availability were not measured. No million-device or contractual SLA claim is made.

The disposable cold backup copy took **533 ms**; restored start plus quarantine **716 ms**; validation through fresh-epoch commit about **742 ms**. These tiny fixture times exclude manual physical reprovisioning, real dataset transfer, cloud networking, Auth/Storage recovery and incident response. One post-snapshot accepted event was lost, demonstrating why production RPO/RTO must be separately defined and tested.

## Release limitations and acceptance status

The local core organization/RBAC/invitation/audit/token/readiness/recovery workflows are implemented and verified as above. **Phase 9 is not certified production-complete.** Outstanding release work includes:

- Authorized complete firmware builds and physical device qualification.
- Staging Supabase migration/grant/Auth verification, live invitation email, sender configuration and environment-specific backup/restore.
- Separately controlled backup/key/object storage, failure alarms, offsite immutability and formal operational ownership/process adoption.
- Docker/private deployment execution and TLS/CA/network/secret-store qualification. Artifacts are a reference, not a complete managed private-cloud offering.
- Optional enterprise SSO/SCIM/domain enrollment, enforced MFA, step-up authentication and session inventory.
- External/all-replica availability probes, public incident history, automated operational paging and any contractual service/support objectives.
- General creator-reassignment/account-deletion workflow and external tamper-evident audit retention.

No production migration has been applied. Commit migration 039 separately before 040; deploy compatible prerequisites/backend before activating customer interfaces. Preserve all queued work, device identities/epochs and replay state on rollback. The ordered guide is [DEPLOYMENT.md](DEPLOYMENT.md); incident and backup procedures are [OPERATIONS.md](OPERATIONS.md) and [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md).
