# Phase 10 implementation and verification report

Local qualification: October 16, 2026. Evidence closeout: October 19, 2026 (UTC). Base commit 27be12d582231ff7b2601f4021c2192474934866, alongside preserved uncommitted prior phases. Closeout validates the retained test reports and current source hashes; it does not redate or claim to rerun the earlier tests. No production migration, device update, notification, deployment, commit or push was performed. The feature defaults off.

## Result

A functioning opt-in device-management foundation is implemented: signed immutable releases, private storage adapters, authenticated HTTPS management, typed desired/reported configuration, durable staged rollouts, operation timelines, permissions/audit, existing-alert integration, embedded reference code, a host A/B test agent and dashboard workflows. Software qualification passes as described below. **Phase 10 is not claimed fully production-qualified:** physical OTA/power-loss tests, hosted services, larger distribution load, automatic schema-layout compatibility and application-specific sustained-health qualification remain outstanding.

## Audit findings and fixes

- Existing Secure V2 UDP has authenticated telemetry/commit receipts, not a general encrypted downlink. Legacy STRC is plaintext plus HMAC and unsuitable for firmware/secrets. Management now uses a separate verified HTTPS path, domain-separated root-derived HMAC and transactional one-use challenges; the production telemetry wire format is unchanged.
- Existing delivery/fleet/enterprise/monitoring foundations are reused for tenants, roles, audit, groups/tags and alerts. Firmware scheduling is a bounded database transaction, not a second webhook retry queue.
- No signed firmware storage, capability enrollment, OTA journal or desired/reported lifecycle existed. Those are implemented without automatically enrolling any customer.
- A shared per-device-compiled image could clone credentials across a fleet. The optional managed starter now persists the same device identity after real bootstrap, loads it from NVS in common firmware, excludes factory credentials in the common build and forbids factory images in signing/upload/reference-agent paths. Actual common binaries were checked for the known test root and factory marker; neither was present.
- Scheduling/download/reboot were insufficient evidence of success. Explicit transitions, immutable identities, a post-boot digest/security/health assertion and exact configuration acknowledgments now control reported outcomes. Timeout remains Unknown. Rollback is reported only after recovery evidence.
- Canceled/paused assignments must still time out and release their active slot. A bounded global expiration pass handles these states without new incoming packets. History cleanup preserves active work.

## Architecture and implemented workflows

Offline P-256/SHA-256 signatures bind a strict versioned canonical manifest, including the persistent-identity contract, organization/key/artifact identity, hardware, version/security floor, agent/bootloader requirements, size and hash. Private keys remain offline. Uploaded objects are immutable; interrupted finalization can verify/reuse an identical orphan without overwrite. Public/anonymous Storage access is denied even behind a prior broad policy.

Only current enabled Secure V2 epochs can authenticate management. Capability/trust/hardware changes invalidate approval. Per-device generations, one-active-operation uniqueness and snapshot target selection prevent duplicate logical commands and silent expansion after group/tag edits. Confirmation and live role checks precede bounded SKIP LOCKED scheduling. Manual percentage-wave advancement is default; success/sample/observation/failure/unknown gates control expansion. Pause/cancel cannot recall in-flight physical work. Execution windows bound new assignment/download and agent initiation; outcome reconciliation remains available afterward.

Configuration supports reporting/sampling intervals and diagnostic level through actual application callbacks. Desired and reported states are separate. Reverting means publishing a new generation with previous values. No arbitrary commands, secret configuration, schema overwrites or remote credential rotation are advertised.

Firmware and Device Operations pages provide signing keys, signed upload, approval, target preview/reasons, staged controls, capability approval, device filters, desired/reported state, paginated operation/target evidence and role-aware controls. Existing device pages link into management. Documentation is published at `/docs/device-operations`. The existing alert engine supports safety-paused-rollout rules and its existing notifications; none are activated automatically.

## Database and operational changes

Migration `supabase/migrations/041_secure_device_operations.sql` adds management settings, public signing keys, immutable artifact definitions, device profiles, challenges, rollouts/targets, per-device operations/events, scoped download tokens and transfer observations. It adds efficient lookup/due/expiry indexes, uniqueness and immutable-artifact constraints, service-only RLS/RPC grants, capability entries, a private Storage bucket/policy and the optional management health component. It extends the existing alert evaluator.

Challenges/tokens expire and are cleaned in bounded batches. Terminal evidence of completed/canceled rollouts expires after 90 days; paused/in-flight work remains. Transfer observations are best effort, 30-day application-response metadata, separate from telemetry and carrier billing. Workspace operational quotas cap stored keys/artifacts/rollouts/targets and reserve at most 512 MiB of artifact bytes. Automatic artifact-object garbage collection remains unsupported. These are safety bounds, not pricing changes.

## Actual testing

- Management/core/database/storage-policy/HTTPS-agent suites: **108 checks passed** (28 + 25 + 28 + 5 + 22). Includes real signatures/key separation, exact config acknowledgment, tenant/grant checks, timeouts, cancellation, current-epoch rejection, trust revocation, bounded cleanup, existing-alert deduplication, real verified HTTPS streaming, tampering, restart/rollback simulation, lost-response reconciliation and unchanged telemetry/receipt identity.
- Actual disposable PostgreSQL: **9 checks passed**, including eight concurrent schedulers, terminated transaction rollback/recovery, concurrent one-use nonce consumption and restricted grants.
- Independent C/mbedTLS/WASI cryptography: passed Node-generated HKDF/HMAC/SPKI/P-256/canonical parsing and tamper vectors.
- Real C++ identity loader: **13 checks passed with an explicitly simulated in-memory NVS contract**. Covers fresh-provisioning guard, identity preservation, explicit replacement/new-wire requirement, commit failure and corruption. This is not physical flash testing.
- Full web suite: **255 passed, two optional embedded source tests skipped by default**. The optional source tests were separately enabled and passed for both boards. Type checking passed.
- Four complete optional managed images built: factory and common environments for ESP32 and ESP32-C3. Offline CLI signing verified both actual common binaries and rejected both factory binaries. Common-image credentials/marker absence was checked. The installed RISC-V compiler required its normal nested bin directory on PATH; no security policy was bypassed. Earlier-phase Device Guard failures did not reproduce in these final builds.
- Production-preview browser suite: **9 workflows passed** across desktop, tablet and mobile, covering real APIs/SQL/local private storage, uploads, approvals, full/range downloads, authenticated simulated-device reports, factory-image rejection, desired/reported state, timelines, docs, responsive overflow and unauthorized/foreign-workspace denial. Screenshots were inspected. Full assistive-technology and physical keyboard qualification were not performed.
- Existing regressions passed: Secure V2 database/7 C–Node golden vectors/UDP/IPv4–IPv6/replay/receipts/batches; TCP parser/real UDP gateway; pipeline database/recovery/retry/SSRF/worker faults; integrations (130 checks); fleet (113); observability (102); enterprise (109); auth, billing and durable onboarding. Pipeline counted suites report 133 checks plus the separately named worker fault scenario suite.
- Production Nuxt build passed: approximately 17.8 MB output / 6.71 MB gzip. Local preview may log the pre-existing unavailable Vercel Analytics script; this is not a customer backend/API failure.

No live cloud Storage/Auth/mail, physical ESP flash/reboot/power-cut, eFuse, qualified rollback bootloader, 10,000-device sustained HTTPS distribution or production tests are claimed.

## Measured performance

Paired local PGlite/actual AEAD samples used 20 warmups and 200 committed packets per migration. Median commit processing was **2.026 → 2.003 ms**; p95 **2.434 → 2.769 ms**; throughput **484.3 → 474.5 packets/s**. This single local sample is not evidence of a statistically significant improvement; the p95 and throughput worsened slightly. No management queries or external calls were added to the telemetry path.

The 1,000 independent-root simulated inventory preview took **68.09 ms**. Ten bounded scheduling transactions averaged **14.13 ms** each; scheduling plus 2,000 authenticated simulator actions took **1.98 s**. A 50-row overview query took **10.94 ms**, returning **113,152 bytes**. Process memory in the evidence includes the embedded database and test harness; it is not production worker or MCU runtime RAM. Build reports and actual binary sizes are preserved separately. No million-device or carrier/battery claims are made.

## Important files

- `protocol/management/core.cjs`, `scripts/firmware-sign.cjs`: signed contracts and offline signing.
- `supabase/migrations/041_secure_device_operations.sql`: lifecycle, scheduling, grants, Storage and monitoring extension.
- `web/server/utils/deviceManagement.ts`, `firmwareStorage.ts`; `web/server/api/device-management/`; `web/server/api/device-operations/`: actual APIs and storage/authentication boundaries.
- `tcp-server/management/worker.js`, `management-worker.js`, `ecosystem.management.config.cjs`: independent scheduler and operational integration.
- `sdk/c/src/StructManagementEsp32.h`, `StructManagedIdentityEsp32.h`, `struct_management_crypto.h`; optional bootstrap-evidence getter in `StructSecureV2Esp32.h`; `sdk/management/node-agent.cjs`: actual device/reference code.
- `web/shared/managementProject.ts`, `secureV2Project.ts`, `web/app/components/SecureV2Setup.vue`: optional complete starter generation and identity-preserving build environments.
- `web/app/components/DeviceOperations.vue`, pages `dashboard/firmware.vue` and `dashboard/device-operations.vue`, sidebar/device links; `web/shared/managementGuides.ts`: product workflows and published guide.
- `tests/management/`, `web/test/management/`, `web/shared/managementProject.test.ts`, `web/server/utils/firmwareStorage.test.ts`: verification. SDK archives were rebuilt.

## Remaining limitations and rollout readiness

The code is ready for review and staging qualification, not blanket production OTA enablement. Existing telemetry-only firmware remains ineligible. Generated examples intentionally do not claim a qualified OTA bootloader or successful health self-test. Real application tests, watchdog/startup timing, NVS/flash protection and physical power-cut/rollback behavior must be qualified on exact hardware.

Publishers must verify immutable schema-slot compatibility manually; automatic signed schema-layout requirements are not implemented. Observation gates follow initial health claims, not continuous hardware attestation or every monitoring metric. Delta images, automated trust-pin rotation, arbitrary commands, other platform agents, named canary-group overrides, persisted resumable download chunks, automatic artifact deletion and global multi-process egress pacing remain unsupported. A failed transfer requires explicit recovery/new rollout; there is no infinite automatic reinstall loop. A revoked key cannot recall a cached offline image, and a raised application security floor can require a newly signed compatible recovery release.

The safe deployment order, environment variables, PM2 commands, retention, rollback/recovery and exact local fixture setup are in `DEPLOYMENT.md`. Stage schema first with flags off, then endpoints/scheduler, then qualified device/staging tests and explicitly approved canaries. Keep journals/queued evidence during application rollback. No production deployment prerequisites were applied automatically.

## Evidence and local commands

Read `AUDIT.md`, `IMPLEMENTATION.md`, `API.md`, `DEPLOYMENT.md`, `sdk/management/README.md` and `evidence/verification.json`. Machine evidence includes baseline, final performance, scale, actual PostgreSQL and signed real-image reports; browser screenshots/log hashes and source hashes are in the verification manifest.

`node tests/management/collect-evidence.cjs` validates and collects the existing local qualification logs, PostgreSQL migration hash, browser result counts, source hashes and SDK archive hashes. It does not execute tests. Raw logs and screenshots are ignored local `work/` artifacts; their summaries/hashes are preserved in the manifest. A fresh clone must rerun qualification to regenerate those local files before collecting new evidence.

Run `npm run test:management`, `npm run test:management:postgres`, `npm run test:management:crypto-c`, `node tests/management/identity-c.cjs`, `npm run benchmark:management`, `npm --prefix web run typecheck`, and `npm run build`. The deployment guide describes the isolated loopback fixture and `npm --prefix web run test:management:browser`; it does not require production credentials or deployment. Use the explicitly enabled optional embedded tests/toolchain only on an authorized build host.
