# Struct Phase 1 & 2 implementation

Reviewed and tested locally: 2026-10-11. Baseline: `9e250927dceb392ae225aef844d8cd7fa5e60a2c`.

This folder records the website, dashboard, documentation and onboarding changes. No production migration, deployment, Stripe mutation, production device test or physical ESP32 test was performed. Changes require deployment review; the database migration must precede the updated web application.

## What changed

- Workspace onboarding now uses durable database evidence of committed telemetry. Retention, selecting another device and creating another device do not reset the workspace milestone. Manual dismissal is stored separately from successful transmission. Existing users are backfilled only from actual retained telemetry or durable ingestion records.
- Device setup progress is separate: published slot, initiated starter download, manually acknowledged configuration, expected reporting interval and first committed reading. A new device never inherits another device's successful packet. The dedicated guide can be revisited from navigation and polls incomplete device progress while visible.
- Activity labels are **Active**, **Inactive** and **Never connected**, with support for a disabled state when supplied. Default activity window is five minutes; a configured interval uses the greater of 90 seconds or three intervals. These describe observed activity, not a persistent UDP connection. Historical `last_seen` can reflect authentication rather than storage.
- Normal schema/device/download flows use Secure V2. New device creation atomically enrolls Secure V2 with usage accounting. Historical firmware tools are separated under `/dashboard/compatibility`; gateway compatibility, old endpoints and research are preserved.
- Sign-in navigates internally to a validated intended dashboard path. Signup without a session stays at email verification. Callback handling avoids using the landing page as a mounted intermediate screen. Loading states avoid early native form submission.
- Billing refresh clears stale feedback, deduplicates requests, awaits membership/usage updates, and treats Free as a normal state. It does not create subscriptions or modify billing terms. Layout startup no longer automatically synchronizes Stripe on every dashboard visit.
- Sidebar uses consistent SVG icons, grouped routes, accessible active states, a mobile focus trap and Escape handling. Device cards prioritize opening the device, with secondary actions grouped. Plan errors use actual capacity data and link to Billing.
- Warm device/schema reads share a 30-second cache and in-flight requests. Usage reads are deduplicated, and responses from a previous workspace are ignored. The chart loads only when readings exist. Sidebar visibility prefetch is limited to Devices and Schema; other destinations prefetch on interaction.
- Ten public, searchable task guides cover first packet, devices, schemas, Secure V2, SDKs, telemetry, webhooks, billing, troubleshooting and historical compatibility. Instructions describe current code rather than planned functionality.
- ESP32 private starter exports include a complete pinned PlatformIO project and actual SDK. A new Node starter includes the actual packed serializer, Secure V2 SDK, durable counter, private configuration, sample values and commands. It lets users test without physical hardware.
- Development and production bundling both resolve the canonical shared packed codec. The development fix transforms the dependency-free CommonJS module at its exact path; it does not fork the serializer or change production telemetry.

## Final first-packet journey

1. Sign up; verify email when required, then sign in directly to the intended dashboard.
2. Create a device. The server checks existing capacity and creates the device and Secure V2 credentials in one transaction.
3. Open Schema, choose the environmental example or define fields and publish an unused immutable schema slot.
4. Select ESP32 / PlatformIO or Node.js. Download a private ZIP containing the selected schema, encoder, sample values and SDK. Credentials are private exports, not public documentation assets.
5. ESP32: extract the whole project, set Wi-Fi in `include/struct_config.h`, select the board/port, build, upload and open the serial monitor. Node: extract the starter, install a supported Node runtime and run `node send.cjs`.
6. Defaults are `ingest.usestruct.com`, UDP 8081, with production Secure V2 authenticated encryption. Each sender needs its own device credentials and durable sequence state.
7. A committed receipt proves database storage and durable webhook queueing, not downstream webhook receipt. Overview shows received telemetry and the workspace milestone becomes permanent. Without a receipt, inspect telemetry and diagnostics before retrying; do not erase counter state.
8. Troubleshoot by symptom using `/docs/troubleshooting`. Firmware upload and configuration are never inferred from downloading a ZIP.

## Review and reproduction

- [Root-cause audit](AUDIT.md)
- [Verification and acceptance evidence](VERIFICATION.md)
- [Measured performance and its limits](PERFORMANCE.md)
- [Deployment order and compatibility](DEPLOYMENT.md)
- [Changed-file inventory](FILES.txt)

From the repository root:

```powershell
npm ci
npm --prefix web ci
npm --prefix tcp-server ci
npm run test:onboarding
npm --prefix web run typecheck
npm --prefix web test -- --exclude shared/secureV2Project.test.ts --pool=threads --maxWorkers=1
npm --prefix web run build
```

The generated-project tests are separate because PlatformIO can install/download embedded toolchains and take longer. With PlatformIO and both board toolchains installed:

```powershell
cd web
npx vitest run shared/secureV2Project.test.ts --pool=threads --maxWorkers=1
```

This Windows environment needed the installed C3 toolchain's nested `riscv32-esp-elf/bin` directory added to PATH for that command. This is an environment workaround, not a generated firmware change.

### Isolated browser fixture

Do not point these tests at production. Terminal 1, from the repository root:

```powershell
npm run test:phase12:fixture
```

Terminal 2, from the repository root, starts the existing local build against the fixture:

```powershell
$env:NUXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:3105'
$env:NUXT_PUBLIC_SUPABASE_KEY='local-fixture-anon'
$env:NUXT_SUPABASE_SERVICE_KEY='local-fixture-service'
$env:NUXT_SECURE_V2_ENABLED='true'
$env:NITRO_HOST='127.0.0.1'
$env:NITRO_PORT='3107'
node web/.output/server/index.mjs
```

Terminal 3:

```powershell
$env:PHASE12_BASE_URL='http://127.0.0.1:3107'
npm --prefix web run test:phase12:browser
node tests/phase12/performance.cjs
node tests/phase12/warm.cjs
```

Install Playwright Chromium if it is not already present (`npx playwright install chromium` from `web`). Browser workflow tests intercept API mutations; the fixture binds only to loopback and uses deliberately fake credentials. It is not a real authentication server. For Protocol Lab regression, use `LAB_BASE_URL=http://127.0.0.1:3107` and `npm --prefix web run test:lab:browser`.

Production validation remains separate: actual provider verification/OAuth, live account authorization and deployment-specific performance must be checked after an approved migration/deployment. No production access is necessary to reproduce the local SQL and real Node-to-gateway integration tests.
