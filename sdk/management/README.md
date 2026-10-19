# Optional management agents (format 1)

These agents add an opt-in HTTPS control plane to an existing Secure V2 credential. They do not change telemetry framing or enable legacy plaintext STRC commands. Server migration 041 and explicit activation are required. Last updated October 16, 2026.

## ESP32 and ESP32-C3

Use the dashboard Schema → private PlatformIO starter → Optional remote configuration agent. Register a public signing key in Firmware, then supply its PEM, fingerprint and your hardware model/revision/bootloader contract. The complete SDK archive includes `StructManagementEsp32.h` and `struct_management_crypto.h`.

The example really applies reporting interval, sampling interval and diagnostic level. It advertises configuration support only. It polls once/minute outside pending telemetry delivery, using verified TLS. The application owns Wi-Fi and time synchronization. Blocking HTTPS can delay telemetry; use an application-owned task and serialized agent access for strict timing requirements.

`begin` takes the actual `client.freshlyBootstrapped()` result for first journal creation. That flag is true only after the telemetry SDK consumes a genuine one-use authenticated bootstrap grant and commits its counter reservation. An old root cannot initialize lost/corrupt management state. Do not replace this argument with an unconditional `true`; rotate/reprovision credentials after state loss. Keep NVS across OTA. Never run several instances for the same credential.

OTA is deliberately **off** in generated starters. To enable it, independently build and qualify an ESP-IDF rollback-capable bootloader, use two compatible app slots, pass `qualifiedRollbackBootloader=true`, and supply a real bounded health callback. `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` must be present in the actual bootloader build. A sketch define cannot qualify a stock prebuilt bootloader. The reference refuses eFuse anti-rollback builds and never enables security fuses. Respect watchdog and pending-verify startup timing. Test the exact production partition/bootloader/flash-encryption combination before enabling OTA.

The signature verifier uses mbedTLS P-256/SHA-256 and checks the SPKI fingerprint against the compiled pin. Signed compatibility and hash checks precede boot selection. The image streams in 4 KiB chunks into the inactive partition. `esp_ota_end` performs platform image validation. After reboot, the complete running-image hash and application health callback must pass before mark-valid and a durable healthy report. A failed candidate requests platform rollback; it reports Rolled back only after observing the prior image on a subsequent boot. Unknown journal/image or NVS failures stop management. Authentication is not hardware attestation.

The application monotonic security counter is not an eFuse guarantee against a physically hostile flash rewrite. Firmware version strings are labels; `securityVersion` is the monotonic downgrade policy. No signing private key belongs in the device. This version pins one public key; planned trust rotation must be implemented in an already trusted firmware or provisioned physically. Keep journal format/ABI compatibility when changing the agent; unsupported format fails closed.

Source/object compilation and independent C/mbedTLS vectors are tested. Complete configuration-capable example images also build for ESP32 and ESP32-C3. The installed RISC-V compiler required its nested bin directory on PATH. Earlier-phase Device Guard failures did not reproduce in the final build runs; no policy was bypassed. No physical flash, power-loss, qualified OTA bootloader rollback or hardware security-fuse tests have passed here.

## Instrumented Node host reference

`node-agent.cjs` exports `ReferenceABAgent` and a verified-HTTPS transport. Its A.bin/B.bin files, durable JSON journal and boot callback model A/B transitions. It is a test/reference agent, not an ESP bootloader or Node runtime firmware updater. The archive contains its canonical cryptography dependency.

```js
const {ReferenceABAgent}=require('./node-agent.cjs')
// Read private options from a restricted local config, never a URL/log.
const agent=new ReferenceABAgent(options)
// Only during explicit initial test provisioning:
await agent.provision({initialImage:'known-test-image.bin',securityVersion:0})
await agent.register()
await agent.runOnce() // requires administrator opt-in and confirmed rollout
// Simulate a new host process/boot, with an application-owned test health check:
await agent.boot(async()=>true)
```

The tests use an ephemeral local TLS CA, real HTTPS, actual HMAC/signature verification and PostgreSQL-engine functions. They verify configuration persistence, signed download integrity, process restarts, replay rejection, rollback simulation and a lost healthy-response reconciliation. They do not establish physical power-loss durability, cloud Storage availability or bootloader correctness. State files are restrictive and fsynced before atomic replacement, but host filesystem power-loss semantics still require platform-specific qualification.

Execution-window semantics: poll responses include bounded remaining seconds. New polls/downloads are refused once the rollout/operation window closes. Reference agents conservatively subtract request duration and check their local monotonic deadline before starting configuration or selecting a boot partition. Already-started transfers/installation and later health/rollback reconciliation may finish after the window; a server pause/cancel cannot recall physical work. No hard real-time physical completion deadline is promised. Firmware transfer observations are best effort with bounded finalization, not billing-grade metering or proof the remote device received every byte.

## Per-device identity across a shared image

Managed firmware must load its existing Secure V2 wire ID/root from the optional persistent `sv2_identity` NVS record. This is the same enrollment identity and replay namespace, not a second credential system. The generated private `struct` factory environment consumes the existing one-use bootstrap and persists that identity; a common `struct-ota` build excludes compiled device IDs/roots/bootstrap tokens and loads each device's own record. Missing or corrupt state fails closed. Never clone NVS or a factory firmware across devices. Physical replacement requires fresh server-issued credentials and explicit factory reprovisioning; normal OTA cannot rotate credentials. Device flash/NVS protection still requires separately qualified hardware controls; no eFuses are programmed.

The signed manifest requires `identityMode: "persistent-nvs-v1"` as part of its canonical identity contract. The offline signer, upload route and reference agents reject the known factory-credential image marker, including a legitimately signed factory-tagged artifact. This catches accidental distribution of the supplied factory builds. It cannot prove arbitrary custom firmware is free of malicious credential access: authorized signing keys remain trusted software publishers. Only upload `struct-ota/firmware.bin`; `firmware.factory.bin` is a merged manufacturing image and is unsupported for OTA. The generator sets the default environment to the private factory build, avoiding an initial upload of both environments before provisioning completes.
