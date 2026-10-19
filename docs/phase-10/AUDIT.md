# Phase 10 architecture/security audit — October 16, 2026

This audit precedes Phase 10 implementation. The checkout includes uncommitted delivery, integration, fleet, monitoring and enterprise phases. Their local tests/evidence exist; production deployment is not inferred. No production systems were accessed.

## Existing capability and constraints

Secure V2 uses device-specific encrypted roots, domain-separated telemetry keys, immutable schema slots, persistent replay/sequence state, authenticated commit receipts and UDP. It does not provide a general encrypted downlink. Legacy STRC commands have HMAC, expiry and durable command journals, but plaintext command payloads. Their legacy credential/channel must not authorize firmware installation or secret configuration.

C/Arduino integrations support ESP32/ESP32-C3 telemetry and authenticated HTTPS counter bootstrap. Node has durable counters and real UDP tests. Python/Rust exist for older telemetry interfaces; no OTA agent is present. Generated PlatformIO projects use pioarduino; no verified OTA partition/rollback enrollment exists. A Windows Device Guard restriction blocked esptool bootloader generation in the previous phase. Physical hardware is unavailable.

The repository has Supabase/PostgreSQL, service-only encrypted credentials, organizations with a tested capability catalog, centralized administrative audit, groups/tags, bulk jobs, delivery leases and monitoring alerts. These should be reused. There is no firmware storage bucket, artifact signature/trust model, OTA scheduler or desired/reported configuration lifecycle. Firmware work must remain separate from webhook delivery and telemetry byte accounting.

ESP-IDF supplies inactive-partition writing, OTA image validation and optional pending-verify/boot rollback APIs. Merely adding an application compiler flag does not retrofit a prebuilt bootloader. Secure boot, flash encryption and eFuse anti-rollback require independent hardware provisioning. This phase must never enable them or claim physical power-loss recovery from a simulation.

## Implementation design

- Separate bounded device-initiated HTTPS management: current Secure V2 epoch only, HKDF-SHA256 `struct.management.v1` domain, fresh server nonce bound to request digest, short expiry and transactional one-use consumption. Device clocks do not determine request freshness; TLS certificate validation remains mandatory.
- Offline ECDSA P-256/SHA-256 signing using maintained Node/mbedTLS implementations. A strict canonical ASCII manifest binds organization, artifact, signing key, compatibility, size/hash and monotonically increasing application security version. No signing private key enters ordinary SaaS configuration. Device trust anchors are provisioned explicitly; server registration does not automatically create device trust.
- Private immutable object storage with bounded streaming upload/download. Supabase Storage is the default production adapter; an isolated filesystem adapter supports local tests. No arbitrary customer artifact URLs. Firmware transfer counters remain separate from telemetry traffic.
- Typed configuration (report/sample intervals and diagnostic level), immutable versions, snapshot targets, monotonic device operation generations, atomic local persistence and authenticated reported state. No secrets, shell commands, schema-slot overwrites or arbitrary expressions.
- Durable per-device firmware/configuration operations, stable rollout target snapshots, canary/waves, bounded scheduling, concurrency, observation/sample/failure gates, explicit pause/resume/cancel/recovery and honest unknown outcomes. Device reports are claims from authenticated agents, not hardware attestation.
- Extend existing permissions/audit and optional operational monitoring. Feature flags default off. Existing telemetry-only firmware remains unchanged and cannot be made OTA-capable through a dashboard checkbox.

## Qualification boundaries

Measure local migration-040 telemetry baseline before adding 041. Verify cryptographic interoperability, actual HTTPS/SQL/device-agent paths, disk persistence, adverse transitions, role/tenant isolation and browser workflows. Attempt real supported toolchain builds; distinguish compile, simulated A/B recovery and physical hardware. Production Storage/Auth/mail/CDN/private-cloud and irreversible hardware settings remain outside automatic execution.

Primary platform references: [ESP-IDF OTA/rollback](https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32/api-reference/system/ota.html), [HTTPS OTA certificate verification](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/system/esp_https_ota.html). The installed framework/version and partition/bootloader capabilities must be checked rather than inferred from newer documentation.
