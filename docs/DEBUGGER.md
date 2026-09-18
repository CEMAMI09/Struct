# Real packet debugger

Apply migration **025_packet_tracing.sql** after 020–024, then deploy the gateway
and web app together. No migration has been applied to a cloud project by the
local implementation workflow.

## Production capture

Open Dashboard → Debugger → Production gateway. Select a device and enable a
15-minute capture (organization writers only). Send a packet with the SDK, then
refresh. Readers can inspect their organization's traces; other organizations
cannot. The latest 200 attempts per device are retained until replaced or the
device is deleted. Tracing is best effort, with at most 32 pending diagnostic
writes per gateway; dropped diagnostics do not block telemetry or receipts.

The stage history comes from the real shared ingestion processor: framing,
identity, HMAC, timestamp window, immutable schema, optional decryption, decoding,
and atomic replay/storage checks. The transaction returns the actual telemetry
event ID, which joins the existing webhook outbox. Webhook status is refreshed
from that outbox, not inferred from a socket write. Use Delivery history for
individual delivery attempts and controlled replay.

Supply credentials as environment variables, not shell arguments:
`STRUCT_HOST`, `STRUCT_KEY_ID`, `STRUCT_API_SECRET`, and `STRUCT_ENCRYPTION_KEY`
when the device requires encryption. `STRUCT_PORT` defaults to 8081. Save bytes
from the generated schema encoder in a local file, then run:

```sh
node scripts/debug-send.cjs payload.bin 1 struct-device-outcome.json
```

This sends real telemetry and can trigger real webhooks. Import the resulting
SDK outcome into the production view. SHA-256 of the complete frame correlates
the SDK result and gateway attempts without exporting payload, MAC or key bytes.
The SDK's `unknown` does not contradict gateway storage success: a receipt can
be lost after commit. A gateway-built receipt never proves device receipt.

## Cloud-free local tests

From the repository root, after `npm install` and installing the gateway's
dependencies:

```sh
node scripts/debug-local.cjs --scenario encrypted --output struct-diagnostic.json
npm run test:debugger
```

Import the JSON in the debugger's Local gateway view. Available scenarios are
`success`, `encrypted`, `malformed`, `authentication`, `duplicate`, `packet-loss`,
`timeout`, `retry`, `schema`, `storage`, and `webhook-retry`.

Each run creates an isolated PGlite PostgreSQL database with the real migrations,
a loopback UDP listener, the real Node SDK and production ingestion processor,
and a loopback HTTP receiver reached through the production outbox worker.
Credentials are random and disposable. Database access uses a local adapter;
Supabase auth/network infrastructure and physical radio behavior are not emulated.
The adapter overrides webhook transport only for the isolated loopback fixture;
production HTTPS/SSRF protections are unchanged. Faults are deliberately injected.
The process closes listeners and database at the end of each run.

To connect your own SDK code to a persistent local gateway:

```sh
node scripts/debug-local.cjs --serve --scenario encrypted --credentials struct-local.env
```

The gateway binds loopback on a free UDP port. It writes disposable local
credentials and that port to the named file (refusing to overwrite an existing
file); load those variables in your local SDK process. Use `--schema schema.json`
for your schema-definition array, version 1. The default is one `uint8` field
named `value`. The local webhook worker runs while the gateway is open. Ctrl+C
stops it and writes the sanitized bundle. The in-memory database resets on exit;
this is a development emulator, not a production server. Keep the credential
file private and outside version control. The local gateway cannot observe the
SDK's final result; import the sender's separate outcome report to correlate it.

## Byte accounting and privacy

Payload, 66-byte protocol header/HMAC, 16-byte optional persistent event identity,
32-byte optional encryption envelope and 69-byte storage receipt are displayed
separately. UDP/IP headers are 28 bytes for IPv4 or 48 for IPv6 per datagram,
before options/extension headers, fragmentation, link layer, radio attachment and
retransmissions. TCP overhead cannot be inferred from a logical frame size.

Production traces and diagnostic exports omit raw payload/frame bytes, decoded
values, credentials, webhook bodies and URLs. Gateway telemetry logs no longer
print decoded readings. Export/import uses a field allowlist, including nested
byte accounting and SDK outcomes. Event IDs, packet fingerprints, timings and
outcomes remain for correlation; treat bundles as operational metadata.

## Explicit limits

- Simulation still generates a browser-only preview and sends nothing.
- Unidentifiable malformed frames and rate-limit/admission drops cannot safely be
  attributed to a tenant; they are not production device traces. Reproduce them
  locally. TCP frames rejected before framing/identity resolution are likewise
  outside the device capture.
- Full production correlation uses per-device telemetry keys. Fleet registration
  currently has partial stage coverage; use a provisioned device key for tracing.
- A duplicate of an event stored before tracing began may have no event link.
  Expired telemetry retention also removes correlation links. Missing links or
  traces are shown as unobserved, never fabricated as successful delivery.
- Detailed instrumentation is not an exactly-once audit log. Gateway crashes can
  commit telemetry before saving diagnostic metadata. The transactional outbox
  remains the source of truth for webhook delivery.
- Device outcome import is a developer observation, not an authenticated device
  attestation. C/Arduino firmware can report its existing delivery enum; automatic
  diagnostic file export is currently provided by the Node SDK command.

Hardware, production Supabase capture and radio-energy behavior still require
staging/device validation. Local tests exercise real software boundaries, not all
possible operating-system or infrastructure failure modes.
