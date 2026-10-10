# Secure V2 qualification and rollout

Secure V2 is additive and defaults off. This repository implementation has been
tested locally. Migration 033 was applied to Struct's Supabase project
`pmjabzoizdwcsozpjais` on October 10, 2026, and recorded as version
`20261010224000` (`033_secure_v2`). The recorded SQL matches the repository file.
Live checks confirmed RLS on all four new tables, service-only execution of all
four RPCs, and preservation of the five existing devices and five schema
versions. No devices were enrolled or credentials issued. Public gateway rollout
and an end-to-end canary remain outstanding; keep the deployment flags off until
the remaining steps below are complete.
Existing legacy credentials and TCP/UDP protocols 2/3/4 remain intact.
The normative format is [protocol-secure-v2.md](protocol-secure-v2.md).

## Deployment order

1. Back up the database and apply `supabase/migrations/033_secure_v2.sql` after
   migrations 001–032. It adds private credential/replay tables, immutable schema
   slots, a unique wire-ID allocator, telemetry identity columns, and four
   service-only RPCs. Do not reset replay high water during telemetry retention.
2. Deploy the gateway changes with `STRUCT_SECURE_V2_ENABLED=false`. If XDP is
   attached, rebuild/reload the updated prefilter first so it permits 25-byte V2
   framing alongside the legacy minimum of 66 bytes. Keep UDP 8081/TCP 8080.
3. Deploy the web changes and regenerated SDK ZIPs with the flag still false.
   Both services must use the existing matching `TCP_CREDENTIAL_KEY`; do not
   rotate that encryption key without migrating encrypted credentials.
4. Enable `STRUCT_SECURE_V2_ENABLED=true` on the gateway, then the web deployment.
   Nuxt supports `NUXT_SECURE_V2_ENABLED=true` as its runtime override; the
   unprefixed variable is read when building Nuxt. Restart/redeploy as needed.
   Keep `STRUCT_SECURE_V2_MAX_FRAME_BYTES=1200` unless a measured network requires
   another supported bound (25–1400). SDKs must use the same or a smaller bound.
5. Enroll ONE canary device explicitly in Dashboard → Schema → Secure V2.
   Enrollment preserves its legacy credential. Publish an unused immutable slot,
   select the physical board and download its private PlatformIO project. New
   projects pin pioarduino 55.03.312-1 / Arduino 3.3.12 / ESP-IDF 5.5.5, retaining
   the ESP32-C3 DevKitM-1 board and its USB flags.
6. Enter Wi-Fi credentials; build/upload without erasing NVS. First provisioning
   requires valid clock, authenticated HTTPS to `www.usestruct.com`, and its
   independent one-use token. Routine sends go to `ingest.usestruct.com:8081`.
7. Confirm telemetry, a verified 21-byte receipt, a single webhook job per event,
   duplicate retry suppression, reordering, reboot skips and credential rotation.
   Verify existing legacy firmware during the same deployment before widening.

Rollback: turn the web flag off first, then the gateway flag. Keep additive tables,
credentials, slots and replay state. Never reset counters/high water or reuse a
wire ID to recover a deployment. A V2-only device pauses ingestion while disabled;
legacy firmware remains accepted. Rotation issues a NEW root AND wire ID, with
optional old-credential grace up to 24 hours.

## Automated checks

```text
python scripts/package-sdk.py
npm test
npm --prefix web run typecheck
npm run build:web
python scripts/check-sdk-archive.py
npm run benchmark:secure-v2
```

`npm test` includes web export acceptance (real ESP32-C3 and ESP32 PlatformIO builds when
available), legacy gateway/SDK/database/delivery/debugger checks, real UDP V2
integration with PostgreSQL functions in PGlite, replay/batch rollback, hostile
frames, bit-packed parity, and independent C/mbedTLS versus Node golden vectors.
The CI job installs pioarduino and mbedTLS so those build gates run there too.
The latest platform uses the pioarduino 6.2.0 CLI (`pio`) and Python 3.10+.

For independent C tests install gcc/clang and mbedTLS. Windows can instead set
`STRUCT_ZIG_COMPILER` to Zig and `STRUCT_MBEDTLS_SOURCE` to an unpacked upstream
mbedTLS source tree; the runner compiles actual crypto into WASI and executes it.
`STRUCT_PLATFORMIO` can select a PlatformIO executable. No production credentials
are used by these tests. The standard JS/legacy tests need only their documented
runtime dependencies; new C conformance deliberately fails if no compiler exists.

## Remaining release qualifications

- Physical ESP32-C3/ESP32 power-cut, NVS commit, reboot, flash-upgrade and erase
  recovery tests. A successful cross-compilation is not hardware evidence.
- Real multi-connection PostgreSQL contention/load and gateway restart tests.
  PGlite executes PostgreSQL functions but serializes its connection; local
  concurrent callers do not qualify distributed production load or latency.
- External review of protocol composition, one-use provisioning, replay RPCs,
  credential rotation and dependency versions before claiming security certification.
- Qualify storage against rollback. Restoring old valid flash/counter files,
  cloning credentials or running two owners can repeat a nonce. Offline SDKs
  cannot detect every rollback. Windows Node directory durability also requires
  filesystem qualification; do not infer it from POSIX fsync behavior.
- Review the pinned Arduino 3.3.12 / ESP-IDF 5.5.5 dependency chain. Native HKDF,
  SHA-256 and TLS remain platform-owned. Omitted ChaCha20/Poly1305 algorithms use
  a small, unmodified Mbed TLS 3.6.7 subset with source hashes and license.
  Upgrade and requalify this pin with the board framework. The older 2.28.10
  subset is retained only for Arduino 2.x compatibility; 2.28 is end-of-life and
  is not the generated starter default. See the upstream
  [2.28.10 notice](https://github.com/Mbed-TLS/mbedtls/releases/tag/mbedtls-2.28.10)
  and [3.6.7 release](https://github.com/Mbed-TLS/mbedtls/releases/tag/mbedtls-3.6.7).
- Confirm production TLS trust/clock and gateway DNS, UDP access, monitoring,
  error rates and outbox delivery. The ESP32 starter pins ISRG Root X1; certificate
  chain changes require deliberate trust updates, never insecure TLS fallback.

## Deliberate scope boundaries

Secure V2 is UDP-only. Legacy TCP framing is unchanged; V2 TCP needs a separate
stream framing specification. C/ESP32 and Node implement V2; Python/Rust currently
remain legacy clients. V2 batches contain one count byte and fixed-size records;
an optional slot sample interval uses server acceptance time. Source timestamps
must be explicit schema fields. Sixteen slots are never silently reused. V2 does
not inherit legacy signed commands or persistent telemetry queues automatically.
