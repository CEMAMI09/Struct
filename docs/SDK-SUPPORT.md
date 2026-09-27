# SDK support and starter downloads

Struct's downloadable SDK is a **release candidate**. Host protocol tests cover the C, JavaScript, Python, and Rust implementations, but the repository does not yet contain physical-device qualification for ESP32, ESP-IDF, Zephyr, STM32, or a cellular modem. See `struct-sdk/compatibility.json` for the versioned matrix; a starter compiling on a host is not evidence of flash durability, battery life, or radio recovery on a board.

## Use a generated starter

1. Download the schema starter from the device's schema editor and the `struct-sdk.zip` SDK archive. Extract both into the same parent directory, so the starter folder, `struct-sdk/`, and `docs/` are siblings. The SDK archive contains `struct-sdk/` and `docs/` at its root.
2. Create a device and copy its credential ID and API secret when they are displayed. The API secret is shown once. Store it outside the project; never commit it. If it is lost, rotate the device credentials in the dashboard and update the device before sending again.
3. Set `STRUCT_HOST`, `STRUCT_PORT`, `STRUCT_KEY_ID`, and `STRUCT_API_SECRET` as described by the starter README. `STRUCT_PORT` defaults to UDP 8081. Use a gateway address reachable from the device, not `127.0.0.1` on remote hardware. If encryption is enabled, also set the separate `STRUCT_ENCRYPTION_KEY`.
4. Run the starter's documented build/send command. Replace the example zero values with readings from the actual device. Confirm a stored receipt and parsed event in the dashboard before treating a send attempt as complete.
5. Configure an HTTPS destination and confirm a successful delivery attempt. A stored receipt means Struct committed the event; it does not mean the customer webhook has received it. Inspect the delivery timeline for retries and failures.

For wire formats, receipt and deduplication semantics, and reliable queue behavior, see `docs/PROTOCOL.md`, `docs/CONTRACT.md`, and `docs/DEPENDABLE-DELIVERY.md` in the SDK archive. For tracing a failed packet, see `docs/DEBUGGER.md`.

## Compatibility and limitations

- Schema versions are immutable after publication. Regenerate the encoder when publishing a new schema and roll out firmware deliberately. Older devices continue to use their saved version.
- Keep a persistent send queue when using confirmed delivery on unreliable links. A transport timeout or missing receipt is uncertain; retry with the original event identity. Do not create a new identity for the same reading.
- Shared fleet-secret provisioning is a setup path, not a substitute for individual device credential rotation and revocation. Protect the fleet secret as a high-impact credential.
- The current packages are candidate artifacts. The owner must select and publish the SDK license and complete the physical release gates in `docs/RELEASE-GATES.md` before calling a target production-supported.

If a starter fails, record the SDK version, schema version, target/compiler, transport, whether a receipt arrived, and the packet trace's diagnostic code. Do not include API secrets, encryption keys, or raw customer payloads in a support report.
