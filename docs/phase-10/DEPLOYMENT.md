# Phase 10 rollout and operations (review only)

No deployment or production migration was executed. Preserve prior uncommitted phases; review their migrations and rollout prerequisites before 041. Do not regenerate existing device identities, credentials, schema slots or replay state.

1. Review migrations 039/040 enterprise roles/recovery/audit and 041 on a staging Supabase project. Take and test a backup. Apply additive schema with all feature flags disabled. 041 creates a private `struct-firmware` bucket only when Storage exists and refuses an existing public bucket of that name. Inspect Storage policy conflicts before production. No historical device is automatically enrolled and no firmware is sent by applying the migration.
2. Deploy backend routes and the new SDK/archive, still disabled. Configure the existing private Supabase service-role key and `TCP_CREDENTIAL_KEY`; do not place either in public runtime config. Signing private keys are offline and are not a server environment variable. Default production Storage is Supabase; do not set `STRUCT_FIRMWARE_LOCAL_TEST`, `STRUCT_FIRMWARE_DIRECTORY` or `STRUCT_MANAGEMENT_ALLOW_LOOPBACK` in production. Require verified HTTPS at the managed web origin and trusted TLS termination; never expose an untrusted direct HTTP management port.
3. Activate `management_settings.enabled` deliberately in staging and set `STRUCT_DEVICE_OPERATIONS_ENABLED=true` in web and the scheduler. Enable the public navigation with `NUXT_PUBLIC_DEVICE_OPERATIONS_ENABLED=true` during the web build. Enterprise recovery/audit configuration remains required. Public navigation does not authorize any operation.
4. Start the independent scheduler using the existing PM2 architecture. It performs no firmware HTTP transfers. Commands below are for an operator to review/run; they were not run against production:

```text
npm --prefix tcp-server ci
node tcp-server/management-worker.js
pm2 start tcp-server/ecosystem.management.config.cjs
node tcp-server/enterprise/probe.js management
```

Use `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRUCT_DEVICE_OPERATIONS_ENABLED=true` and the existing optional enterprise heartbeat configuration. Mark the management component expected in the private service configuration only when intentionally deployed. Health records cycle/error/assignment counters and last successful database cycle; a stale process/dependency is not healthy. Multiple schedulers are safe via row locks; tune bounded concurrency after real database/network measurements. Graceful shutdown waits for the active bounded RPC. On errors the worker backs off three seconds. Cleanup runs periodically in bounded batches.

5. Qualify exact ESP32/C3 hardware, partitions, watchdog, signed image handling and rollback bootloader on a disposable device. Verify corrupt/wrong-platform images, Wi-Fi loss, partial download, NVS failure, power cuts before/after boot selection, failed health, rollback reporting and interrupted trust/credential rotation. No physical test or irreversible eFuse changes occurred here. A stock telemetry starter remains OTA-ineligible; do not merely change its reported capability.
6. Register an offline public signing key and pin it in that qualified firmware. Provision new test credentials through the existing one-time Secure V2 bootstrap. Check capability reports, explicitly approve the epoch and create a small confirmed canary rollout. Verify device health, monitoring alert preferences and actual egress before expanding percentages. Existing users receive no automatic updates or notifications.

## Rollback and recovery

Disable public navigation and stop/pause the management scheduler to stop new assignments. Pause/cancel through the authorized API before stopping when possible. Keep migration 041, artifacts and journals: do not drop queue/history tables or roll back by erasing device NVS. Already assigned/offline work can still execute; changing web flags cannot recall it. Keeping the device report/download endpoints available permits reconciliation of in-flight work. A server signing-key revocation blocks future downloads but cannot untrust cached images on offline devices.

If the web release must be rolled back, maintain compatible management endpoints or accept honest Unknown outcomes until restored. Telemetry remains independent. Recover a broken fleet with a new explicitly signed compatible release or qualified device bootloader rollback; never weaken replay/signature checks. A restored database must pass the existing enterprise recovery gate and epoch-reprovisioning procedure before management resumes. Retain the separate credential master key backup securely.

## Local verification

```text
npm run test:management
npm run test:management:postgres
npm run test:management:crypto-c
npm run benchmark:management
npm --prefix web run typecheck
npm run build
```

The optional C test requires a host compiler/upstream mbedTLS or the installed Zig/WASI test tools. ESP source qualification runs `STRUCT_MANAGEMENT_EMBEDDED_TESTS=true` with the installed PlatformIO/toolchains. Full generated firmware builds passed in final qualification. The installed RISC-V package requires its `riscv32-esp-elf/bin` subdirectory on PATH; configure that normal compiler path on this build host. Earlier Device Guard failures did not reproduce and no policy was bypassed. Builds do not qualify physical OTA or a rollback-capable bootloader.

Browser fixture: set `STRUCT_MANAGEMENT_FIXTURE=true` and `STRUCT_ENTERPRISE_FIXTURE=true`, run `node tests/fleet/http-fixture.cjs` (loopback 3125). Run the web app on loopback 3120 with Supabase URL `http://127.0.0.1:3125`, fake anon/service keys, test credential encryption key `34` repeated 32 bytes, management/enterprise flags enabled, `STRUCT_MANAGEMENT_ALLOW_LOOPBACK=true`, `STRUCT_FIRMWARE_LOCAL_TEST=true` and a private disposable `STRUCT_FIRMWARE_DIRECTORY`. Then run `npm --prefix web run test:management:browser`. These fixture flags/credentials must never be deployed. Desktop/tablet/mobile test identities are separate to respect real per-user rate limits. Actual HTTPS tests independently generate a temporary CA and verify certificates rather than disabling TLS.

For a fully isolated browser check, use these PowerShell commands from the repository root. The keys below are fixture values, not production credentials. Use separate terminals; keep the fixture running during the web/browser commands.

Terminal 1:

```powershell
$env:STRUCT_MANAGEMENT_FIXTURE = 'true'
$env:STRUCT_ENTERPRISE_FIXTURE = 'true'
node tests/fleet/http-fixture.cjs
```

Terminal 2:

```powershell
$env:NUXT_PUBLIC_SUPABASE_URL = $env:SUPABASE_URL = 'http://127.0.0.1:3125'
$env:NUXT_PUBLIC_SUPABASE_KEY = $env:SUPABASE_KEY = 'local-anon-key'
$env:SUPABASE_SERVICE_KEY = $env:SUPABASE_SERVICE_ROLE_KEY = $env:NUXT_SUPABASE_SERVICE_KEY = 'local-service-key'
$env:TCP_CREDENTIAL_KEY = '34' * 32
$env:STRUCT_DEVICE_OPERATIONS_ENABLED = 'true'
$env:NUXT_PUBLIC_DEVICE_OPERATIONS_ENABLED = 'true'
$env:STRUCT_ENTERPRISE_ENABLED = 'true'
$env:NUXT_PUBLIC_ENTERPRISE_ENABLED = 'true'
$env:STRUCT_MANAGEMENT_ALLOW_LOOPBACK = 'true'
$env:STRUCT_FIRMWARE_LOCAL_TEST = 'true'
$env:STRUCT_FIRMWARE_DIRECTORY = Join-Path (Get-Location) 'work/management/artifacts'
npm run build
$env:NITRO_HOST = '127.0.0.1'
$env:NITRO_PORT = '3120'
node web/.output/server/index.mjs
```

Terminal 3:

```powershell
npm --prefix web run test:management:browser
```

The default project can otherwise be started with `npm run dev:web`. Management stays unavailable without its explicit server/database activation. Do not reuse the fixture environment for a production build or deploy it. Stop the two foreground local services with Ctrl+C afterward.
