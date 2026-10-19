# Phase 6 verification and completion report

Verification date: 2026-10-12. All records, credentials, servers and database clusters used here were disposable and local. No production migration, deployment, device access, customer-data change or pricing change was performed. The feature remains default off.

## Implemented architecture and workflows

- Organization-scoped inventory with 50-row server pagination, indexed identifiers, name/identifier search, lifecycle/activity/schema/group/tag/date filters and name/created/last-seen sorting. Existing overview/setup selectors are bounded to 100 recent devices plus a requested device; they link to the complete inventory.
- Flat many-to-many groups, normalized tags, counts, confirmed group deletion and bulk assignment/removal. Phase 7's existing routing matcher and transactional enqueue snapshot include group/tag membership. Changes affect future telemetry only.
- Quantity creation with prefix/start/padding, pasted lists and deterministic CSV column mapping. Inputs are validated on the server, previewed, explicitly confirmed and processed outside the browser. Duplicate policies are reject, skip or approved metadata-only update. Existing credentials/identity/immutable schemas are never replaced by duplicate import.
- Durable per-item jobs, progress/results, frozen filtered selections, administrative version checks, cancellation, reviewed failed-item retries, random fenced leases and crash recovery. Device mutation and result commit atomically. Existing billing/device-count guards remain authoritative.
- Bulk descriptions/metadata, groups/tags, enable/disable, terminal revocation and soft archive. New-device source-schema copy uses immutable publication. Hard deletion and reassignment of existing firmware schemas are intentionally unavailable.
- Real Secure V2 enrollment, independent random roots, existing encrypted credential storage, explicit audited one-time manufacturing manifest (100 devices/request) and manual reprovisioning with a new wire epoch and immediate old-key revocation. Current-epoch first successful commit verifies replacement provisioning separately from lifetime onboarding.
- Dark responsive inventory, selection toolbar, creation/import forms, previews/confirmation, job history/details, downloads, group management, contextual SDK links and four public guides. No second delivery queue or routing engine was introduced.

## Automated verification

Final machine-readable outcomes, log hashes, source hashes and environment versions are in [evidence/verification.json](evidence/verification.json). Large transient logs/compiler downloads stay under ignored `work/fleet/` rather than in Git.

| Suite | Verified result | Boundary |
| --- | --- | --- |
| `npm run test:fleet` | 113 assertions passed: database/gateway 37, tenancy/credentials/routing 29, operations/recovery 29, worker 8, UDP 10 | Real migration SQL in PGlite; real Node UDP SDK/gateway/AEAD/receipt path |
| `npm run test:fleet:postgres` | 11 checks passed, four PostgreSQL backends | Actual PostgreSQL 18.4, concurrent transactions and terminated backend |
| Web Vitest | 219 tests passed in 43 files, 48.87 s, with `--maxWorkers=2` | Complete existing web suite, including fleet, Protocol Lab, auth, billing and generated firmware |
| Fleet Playwright | 18 tests passed, about 1.3 minutes | Six workflows on desktop, tablet and mobile; real Nuxt APIs, SQL, RLS and worker; simulated authentication |
| `npm run test:integrations` | 130 checks passed: 44 core, 47 database, 39 contracts | Existing adapter/routing/tenant regression suites, local contracts |
| `npm run test:pipelines` | 50 database + 18 recovery + 57 policy + 8 startup checks passed; fault suite also passed | Existing outbox/retries, HTTP HMAC, database outage and two-worker dispatch |
| Gateway package suite | Passed | Parser/protocol, crypto/replay, transports, webhook SSRF, worker and Secure V2 gateway |
| `npm run test:secure-v2` | Passed | SQL replay/batching/slots; packed Node/C-WASI parity; IPv4/IPv6 UDP; seven independent C/mbedTLS golden vectors, tampering, persistence, reboot, erase, rotation and retries |
| Base database/auth/billing suites | Passed | Local migration permissions, authentication boundaries and existing billing accounting |
| Nuxt typecheck and production build | Passed | Output 17.6 MB, 6.65 MB gzip; existing dependency deprecation and large-chunk warnings remain |

The generated projects were compiled for the two actual supported boards: `esp32-c3-devkitm-1` and `esp32dev`. Independent host crypto verification used isolated Zig 0.15.2 and upstream mbedTLS 3.6.7. These are compilation/host tests, **not physical hardware tests**.

### Failure and recovery evidence

Database tests cover idempotent previews, duplicate external/serial identities, split-identity rejection, concurrent claims/finishes, actor permission loss, administrative conflicts, cross-tenant references, cancellation, lease expiry/fencing, one-time exports, archived-device preservation, retention and future-only routing snapshots. Actual PostgreSQL testing terminates a backend during an uncommitted mutation, verifies rollback, expires/reclaims its lease and verifies exactly one eventual device result.

The local UDP test obtains an authenticated committed receipt, disables the device and verifies no storage/success receipt, re-enables it with counter gaps, then revokes it and verifies rejection while preserving prior telemetry. Other regressions verify old credentials fail after reprovisioning, the new epoch accepts valid readings, counters remain epoch-specific and failed packets do not verify provisioning. These do not establish remote firmware rotation.

Browser tests exercise real 55-device registration, page/all-filter selection, disable, group and tag/metadata changes, dates, docs, CSV Unicode mapping, result export, explicit credential disclosure and rejection of repeat disclosure. A deliberately aborted successful preview response is retried with the same request UUID/job. Group rename/delete preserves devices; deep-linked older-device setup and the one-device creation shortcut remain reachable. Keyboard focus and mobile horizontal overflow are checked. Screenshots are in [evidence](evidence/).

During verification, fixture bugs in SQL placeholders and identifier/projection parsing caused initial browser failures; these were corrected without loosening database grants. The Windows ESP32-C3 build needed its installed cross-compiler directory on the test process PATH. A highly parallel web run exceeded the existing Protocol Lab archive-test timeout; final verification limits test concurrency. These failed attempts are recorded separately in the evidence manifest and are not counted as successful runs.

## Actual performance

### Inventory and registration

[qualification.json](evidence/qualification.json) enrolls **9,999 new Secure V2 devices**, plus the existing fixture sender, then compares the former full-inventory query with the new 50-row query. Timings include local SQL execution and JSON serialization, exclude Supabase/network RTT, and use five timing samples per query.

| Inventory | Former query median / JSON size | New query median / JSON size |
| --- | --- | --- |
| 100 | 1.87 ms / 60,320 B | 1.62 ms / 21,931 B |
| 1,000 | 14.79 ms / 605,611 B | 4.09 ms / 22,183 B |
| 10,000 | 129.63 ms / 6,085,502 B | 28.34 ms / 22,428 B |

Registration stages created 99 devices in 252 ms, 900 in 2,577 ms and 9,000 in 124.75 s (72.1 devices/s in that final stage). Other regression work ran concurrently, so this is an observed local result rather than isolated peak throughput. The production worker additionally has two RPC round trips per item and a 10 ms pacing delay; these SQL-only rates are not hosted worker capacity.

Parsing/validating the 10,000-row, 507,807-byte CSV took a median **15.04 ms**. Freezing a 10,000-device filtered preview took **3,553.84 ms**. The PGlite process peaked at an observed 896 MB RSS including its in-process database, not worker-only memory.

[load.json](evidence/load.json) separately uses a **synthetic 100,000-row metadata inventory**, not 100,000 credentialed enrollments. Median query times were 231.8 ms default, 135.4 ms search, 138.1 ms tag filter and 253.5 ms name sorting. This in-process database measurement does not prove production or browser response times; RSS was about 1.07 GB including the database.

### Ingestion during enrollment

[ingestion-load.json](evidence/ingestion-load.json) measures actual loopback PostgreSQL 18.4 commit transactions with the existing durable outbox enabled. Each stage commits 500 readings. It excludes gateway encryption, UDP, Supabase HTTP and physical devices.

| Stage | Median SQL commit | p95 | Commits/s |
| --- | --- | --- | --- |
| Migration 036 baseline | 0.619 ms | 0.919 ms | 1,469.8 |
| Migration 037 idle | 0.682 ms | 1.025 ms | 1,353.2 |
| Migration 037 with concurrent enrollment | 0.700 ms | 0.969 ms | 1,317.1 |

The concurrent job enrolled 500 devices in **955.84 ms** (523.1/s, SQL-only). All **1,500 telemetry events and 1,500 delivery intents** persisted. This shows measurable overhead; it does not establish negligible production impact. The Node coordinator used about 87 MB RSS, excluding PostgreSQL child-process memory. Database CPU, hosted worker throughput, WAN latency and hardware fleet behavior remain unmeasured.

## Database and important file inventory

- [037_fleet_management.sql](../../supabase/migrations/037_fleet_management.sql): device lifecycle/identity/metadata/provisioning columns, inventory/GIN/uniqueness indexes, flat groups/memberships, jobs/items/audit, RLS, service-only RPCs, lifecycle wrappers and routing snapshot extensions. Migration SHA-256: `2f999cd107be3fcf336c8ff09cb0c866cf02e4647932c577a235af0e15d4d588`.
- `tcp-server/fleet/worker.js`, `fleet-worker.js`, `ecosystem.fleet.config.cjs`: asynchronous enrollment/admin execution and operation. `ingest.js` / `secure-v2.js`: per-packet lifecycle enforcement.
- `web/server/api/fleet/*`, `web/server/utils/fleet.ts`, `web/shared/fleet.ts`: authenticated APIs, bounded parsing/selection, export/provisioning and typed contracts.
- `web/app/components/FleetManagement.vue`, `LegacyDevices.vue`, `DeviceList.vue`, `web/app/pages/dashboard/devices.vue`, `web/app/composables/useDevices.ts`: current fleet UI plus preserved compatibility UI and bounded selectors. `web/nuxt.config.ts`: default-off public flag.
- `web/shared/fleetGuides.ts`, `documentation.ts`, `web/app/pages/docs/[slug].vue`: current published guides/version dates. `deviceActivity.ts` and types: lifecycle/status consistency. `IntegrationRuleEditor.vue` and `tcp-server/integrations/config.js`: existing routing compatibility.
- `tests/fleet/*`, shared/API/composable fleet tests, `web/test/fleet/workflows.spec.ts`, `web/playwright.fleet.config.ts`: SQL, worker, security, concurrency, UDP, load and actual browser checks. Root/web package scripts expose reruns.

New tables are `fleet_settings`, `device_groups`, `device_group_members`, `fleet_jobs`, `fleet_job_items` and `fleet_audit`. Device additions include external/serial identifiers, description/metadata, labels, lifecycle, administrative version, manifest-export time and current-epoch first-seen time. Composite tenant foreign keys, unique identity indexes, RLS and service-only worker functions enforce boundaries. Existing encrypted credentials, UUIDs, immutable slots, replay state, telemetry and delivery history are preserved.

## Remaining limitations and deployment review

- No production migration or deployment was performed. Migrations 035/036 are prerequisites; those earlier uncommitted changes require their own release review. Review [DEPLOYMENT.md](DEPLOYMENT.md), apply in staging, then enable database/server/UI flags and start the fleet worker deliberately.
- Real hosted Supabase Auth/PostgREST/RLS integration, hosted latency/load, gateway-cache behavior across production instances, and physical-device manufacturing/reprovisioning remain staging/hardware prerequisites. Browser auth is simulated even though APIs, SQL and worker execute unchanged.
- Rotation is manual reprovisioning with immediate revocation, no old-key overlap, no remote delivery/acknowledgment. A private manifest proves credential disclosure, never physical provisioning. Losing a one-time download requires separately authorized SDK retrieval or deliberate reprovisioning.
- Flat groups only; no nesting, saved views, separate unused-tag catalog, arbitrary metadata full-text search or status/schema/group sorting. Offset browsing caps at 100,050 records; narrow filters beyond that bound. Exports cap at 10,000 rows and private manifests at 100.
- Existing-device bulk immutable-schema reassignment is not implemented. New registration may copy a source slot. Changing a server metadata record does not remotely configure firmware.
- Archive is soft deletion, does not free an existing billing slot and preserves history/delivery work. Terminal revoked/archived records cannot be re-enabled. No destructive cascade deletion is exposed.
- Invalid CSV rows must be corrected before confirmation; valid imports can subsequently have reported per-item failures. Names can repeat; external IDs and serials are the stable optional duplicate keys. Raw CSV is not retained, but normalized job input/results persist up to 30 days or the latest 50 terminal jobs. Pending work is not auto-deleted. Audit retention is 365 days.
- No million-device, live-cloud, database-CPU or physical-hardware claim is made. This is ready for **deployment review and staged qualification**, not an assertion that every requested capability or production-scale acceptance criterion has been verified.

See [README.md](README.md) for local application/test instructions and [ARCHITECTURE.md](ARCHITECTURE.md) for security, retention and lifecycle details.
