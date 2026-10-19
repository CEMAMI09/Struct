import type { Guide } from './documentation'
export const MANAGEMENT_GUIDES: Guide[] = [
  {
    slug: 'device-operations',
    updated: 'October 16, 2026',
    title: 'Secure firmware and remote configuration',
    summary:
      'Prepare signed releases, opt in compatible devices and verify staged rollout evidence.',
    sections: [
      {
        title: 'Availability and device requirements',
        paragraphs: [
          'Device operations require explicit server/database activation. Telemetry-only Secure V2 firmware does not gain OTA automatically. Existing UDP framing, encryption, counter reservation, replay protection and commit receipts remain unchanged. The optional agent uses a separate certificate-verified HTTPS connection and the current device root-derived management key. Previous credential epochs cannot manage devices even during a telemetry grace period.',
          'The ESP32/ESP32-C3 reference supports typed configuration. OTA additionally requires two application partitions, a separately built and qualified rollback bootloader, adequate free partition space, a pinned public signing key and real application health checks. The generated starter intentionally advertises OTA as unsupported. No secure-boot, flash-encryption or anti-rollback eFuses are programmed. Both configuration-capable ESP32/C3 examples build; host A/B tests are simulations, not physical ESP32 power-loss qualification.',
        ],
      },
      {
        title: 'Prepare and sign firmware offline',
        paragraphs: [
          'Register only the public P-256 PEM in Firmware. Keep the signing private key offline with restricted access and backups. Use the displayed key UUID and SHA-256 SPKI fingerprint when building your firmware trust configuration. The signed manifest binds workspace, artifact, key, platform, hardware model/revision, version, application security version, minimum agent/bootloader version, length and full-file SHA-256. Firmware versions are immutable per workspace/model/revision.',
          'Create metadata JSON with artifactId (new UUID), organizationId, keyId, platform (esp32 or esp32c3), identityMode:"persistent-nvs-v1", hardwareModel, hardwareRevision, version, securityVersion, minAgentVersion:1 and minimumBootloaderVersion. The tool adds format, size and sha256. Sign only a compiled application binary, not a merged bootloader/partition image. Upload the signed JSON and exact binary. Signature/hash/header verification precedes administrator approval. An approved artifact is still not deployed.',
        ],
        code: 'node scripts/firmware-sign.cjs keygen offline-private.pem public.pem\nnode scripts/firmware-sign.cjs sign firmware.bin metadata.json offline-private.pem signed-release.json',
      },
      {
        title: 'Enable a compatible device',
        paragraphs: [
          'In the SDK starter generator, explicitly select the optional configuration agent and enter the registered public key, fingerprint and hardware contract. Fresh credentials are needed when initially creating its durable management journal; use the genuine one-use authenticated bootstrap result. Never erase NVS to reset a generation or security counter. A device with missing/corrupt management state fails closed and needs fresh credential reprovisioning.',
          'The private struct factory environment persists the same device-specific identity after genuine bootstrap. Common struct-ota images exclude compiled credentials and read each device’s own NVS identity; never upload a factory image or clone NVS. The signer/upload route reject the supplied factory-image marker. The signed identityMode contract is persistent-nvs-v1. After the device registers capabilities, review them in Device Operations and explicitly enable that credential epoch. Capabilities are authenticated claims, not hardware attestation. The administrator must qualify the bootloader and hardware. Enabling management does not enable an unsupported OTA implementation.',
        ],
      },
      {
        title: 'Preview and stage a rollout',
        paragraphs: [
          'Choose an approved artifact or typed configuration. Target explicit device UUIDs, a group, a tag or all workspace devices. Group/tag membership is snapshotted at preview, so later organization changes do not silently expand the target list. Review eligible/ineligible targets and reasons before confirming. Percentages are cumulative with a deterministic target order; the default is 1%, 10%, 25%, 100%. There is no explicit named-canary subgroup override in this version.',
          'Assignments are bounded by concurrency and starts/minute. A wave advances only after every target succeeds, the observation window elapses and the minimum sample requirement is met. Manual advancement is the default. Failure/unknown thresholds, incompatible changes, changed initiator permissions and expired rollout windows pause new scheduling. Pause stops new assignments; already-assigned devices may continue. Cancellation cancels only unstarted work and is not a physical rollback. Unknown means no sufficient confirmation, not proof of failure.',
        ],
      },
      {
        title: 'Desired versus reported configuration',
        paragraphs: [
          'Supported fields are reportIntervalSeconds (10–86400), sampleIntervalSeconds (1–reportIntervalSeconds), and diagnosticLevel (none/error/info). Values are declarative and bounded. Arbitrary scripts, network secrets, credential replacement and schema edits are unsupported. The application callback must actually validate/apply these settings.',
          'The service records desired configuration at assignment. Reported configuration changes only after a matching authenticated applied acknowledgment for the current generation. The reference starter samples and reports on its configured intervals. Revert by creating a new configuration rollout with the previous approved values; monotonic generations prevent replaying an older command. No firmware or schema is silently rewritten.',
        ],
      },
      {
        title: 'Installation, health and recovery',
        paragraphs: [
          'Available and Assigned are server evidence. Downloading, Verified, Installing, Awaiting reboot, Booting, Healthy, Applied, Failed and Rolled back are authenticated agent claims recorded with server receipt timestamps. Healthy requires the expected full-image digest, security version and application health confirmation after the appropriate transition. These claims do not provide remote attestation or prove that compromised firmware is truthful.',
          'The optional ESP agent streams into the inactive partition, verifies the signature and full-file digest and calls Espressif image validation before selecting it. It marks a candidate valid only after the application health callback succeeds. A rollback is reported only after the prior image is observed on a later boot. If state is ambiguous or NVS fails, the agent stops management rather than inventing success. Preserve NVS, partition layout and bootloader across updates. Failed firmware below a raised application security floor cannot be redeployed; recovery requires a newly signed compatible image with a sufficient security version.',
        ],
      },
      {
        title: 'Trust rotation, limits and retention',
        paragraphs: [
          'Revoking a server signing key blocks new assignments/downloads. It cannot remove pins from offline firmware or undo a previously downloaded release. Provision replacement trust explicitly through an already trusted release or a controlled physical update. The current embedded reference pins one key; automatic remote trust rotation is not implemented. Never upload a private key.',
          'Limits: 4 MiB per image, 512 MiB reserved artifact bytes per workspace, 10,000 targets/rollout, six cumulative percentage waves, 100 simultaneous operations/rollout, 1,000 assignments/minute/rollout, four uploads and eight download streams per web process. Transfer counters count bytes sent by Struct, not carrier billing. One-use challenges expire after 60 seconds and scoped download tokens after ten minutes. Temporary challenges/tokens are cleaned in bounded batches; transfer metadata is retained 30 days. Terminal operation/target evidence of completed or canceled rollouts expires after 90 days in bounded batches; paused/in-flight work is preserved. Operational limits cap 100 keys, 1,000 artifacts, 1,000 retained rollouts and 1,000,000 retained target decisions per workspace. Automated artifact garbage collection is not yet provided.',
        ],
      },
      {
        title: 'Monitoring and troubleshooting',
        paragraphs: [
          'The existing Alerts system supports rollout_failures: the current number of safety-paused rollouts affecting the selected device/group/tag scope. Configure thresholds, acknowledgment, cooldowns and email/webhook preferences there; installing device operations never enables customer notifications automatically. The incident survives notification failures.',
          'If a device is ineligible, inspect its epoch, lifecycle, enrollment approval, hardware contract, partition size, key fingerprint and security floor. If it never checks in, inspect Wi-Fi, verified TLS clock/CA and the management endpoint. Never disable TLS verification. Download failures leave the existing running image untouched. Inspect the per-operation timeline, safe error category and device serial output. A timeout remains Unknown until an eligible late report reconciles it. Fix the cause and create a new explicit rollout; there is no silent infinite reinstall loop.',
        ],
      },
    ],
  },
]
