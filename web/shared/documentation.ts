import { MANAGEMENT_GUIDES } from './managementGuides'
import { ENTERPRISE_GUIDES } from './enterpriseGuides'
import { FLEET_GUIDES } from './fleetGuides'
import { OBSERVABILITY_GUIDES } from './observabilityGuides'
import { INTEGRATION_GUIDES } from './integrationGuides'
export interface GuideSection {
  title: string
  paragraphs: string[]
  code?: string
}

export interface Guide {
  slug: string
  updated?: string
  title: string
  summary: string
  sections: GuideSection[]
}

export const GUIDES: Guide[] = [
  ...MANAGEMENT_GUIDES,
  ...ENTERPRISE_GUIDES,
  ...OBSERVABILITY_GUIDES,
  ...FLEET_GUIDES,
  ...INTEGRATION_GUIDES,
  {
    slug: 'delivery',
    title: 'Delivery lifecycle and recovery',
    summary:
      'Trace stored readings, investigate webhook failures and safely recover delivery.',
    sections: [
      {
        title: 'Availability',
        paragraphs: [
          'The advanced delivery pipeline requires an explicitly activated deployment. If your dashboard shows the previous delivery history, ask your administrator about rollout status. Do not assume the new recovery windows apply to a legacy worker.',
        ],
      },
      {
        title: 'Separate the guarantees',
        paragraphs: [
          'Secure V2 authenticates and decrypts a packet, resolves its immutable schema slot and decodes each reading. PostgreSQL commits the sample, a durable event identity and eligible destination-specific delivery records together. Only after the ingestion RPC succeeds can the gateway build the authenticated device receipt. A failed database or outbox transaction cannot produce a successful commit receipt.',
          'Received, authenticated and decoded describe gateway evidence, while Stored and Queued describe database evidence. The delivery timeline records database transaction time and worker attempt times. It does not invent an arrival time or show a missing UDP packet as rejected. Authenticated gateway capture, when enabled before sending, adds actual processing stages. Failed authentication is not attributed to a customer device merely from the packet header.',
        ],
      },

      {
        title: 'Signing and duplicate requests',
        paragraphs: [
          'Each webhook retains the existing raw-body HMAC-SHA256 contract: x-struct-signature is sha256= followed by the hexadecimal digest. Verify the exact raw bytes before parsing; see the complete Node receiver in Webhooks. body.id and x-struct-event-id identify the original reading. x-struct-delivery-id identifies its destination delivery and stays stable across automatic retries and manual replay. x-struct-attempt increases across recovery cycles.',
          'Return any HTTP 2xx only after safely accepting the event. Struct records the response, not the completion of every later process in your application. A request can succeed remotely before a timeout or worker crash prevents Struct recording it. Atomically deduplicate event IDs in your own database. A replay retains the original event ID, so deliberate reprocessing needs an explicit receiver policy. The legacy signature has no signed delivery timestamp; maintain durable deduplication and protect/rotate the destination secret using your existing controls.',
        ],
      },

      {
        title: 'Automatic retry policy',
        paragraphs: [
          'When the new delivery pipeline is enabled, HTTP 408, 429 and 500–599 and connection/DNS/timeouts retry. Most other HTTP errors, redirects and invalid public-HTTPS destination configuration are terminal. Redirects are never followed. The timeout is eight seconds. Backoff starts at five seconds, doubles per attempt, adds bounded zero-to-five-second jitter and is bounded at one hour. Retry-After seconds or dates are honored up to one hour when inside the retry deadline.',
          'Automatic delivery stops after eight attempts or 24 hours per cycle. The worker stores attempts when claimed and records status, safe error category, response code, elapsed time and next retry. A 60-second lease recovers abandoned claims with an unknown remote outcome. Endpoint dispatch is limited to one active request and ten starts/second; a tenant has up to eight active claims. The process concurrency setting can further reduce those limits.',
        ],
      },

      {
        title: 'Use Delivery to investigate',
        paragraphs: [
          'Open Delivery, filter by device, destination, event UUID, status, error category, time range, attempt count or protocol. Results are queried server-side, 50 per page. Trace shows the reading, schema slot, sequence, batch index, queue record, attempts, response metadata and manual actions. Historical events may lack gateway/schema metadata; that absence is labeled.',
          'Destination health shows backlog, last success and failed/unknown attempts in the last 24 hours. Pause retains work and blocks new claims; an already-started request may finish. Disable/removal is a configuration change that can dead-letter work. Fix the receiver before resuming or recovering failures.',
        ],
      },

      {
        title: 'Retry, replay and cancel',
        paragraphs: [
          'Retry a failed or skipped delivery while its payload remains available. Replay a delivered event only when you intend another request. Both keep the original reading and delivery identities. Use Retry eligible matches to preview the oldest 100 eligible failures across the current destination, device, event and time filters (the status filter is replaced by failed/skipped eligibility), or select individual rows. Select up to 100 deliveries per recovery request; the UI previews eligibility and requires duplicate-processing confirmation. Bulk operations are all-or-nothing and are limited to twenty actions/minute/workspace. Each delivery supports three manual recovery cycles.',
          'Cancel applies to queued work, not a request already in flight. Every accepted action is audited and scheduling uses a request UUID for idempotency. The confirmation message means queued, not delivered. Owner/admin permissions are checked again in PostgreSQL; viewers can inspect permitted evidence but cannot schedule recovery.',
        ],
      },

      {
        title: 'Retention and overload',
        paragraphs: [
          'The new pipeline keeps delivery recovery payloads for seven days independently of telemetry sample retention. At expiry, remaining work becomes a recorded payload-expired dead letter and cannot be replayed. Delivery metadata, attempts and event identities last thirty days. Workspace deletion still removes its data. These are bounded operational recovery windows, not a promise of indefinite delivery or new subscription benefits.',
          'A service-controlled pending-work ceiling (default 100,000 per workspace) prevents unlimited backlog. If atomic enqueue would exceed it, ingestion rolls back and cannot issue a commit receipt. Firmware should retain and retry the original frame according to its existing policy. Queue and retention policy must be reviewed during rollout. Historical events are not automatically sent when the migration is installed.',
        ],
      },

      {
        title: 'Troubleshoot by evidence',
        paragraphs: [
          'No stored reading: check Wi-Fi, endpoint/UDP port, current credentials, schema slot, receipt result and authenticated diagnostics. Unknown receipt can mean accepted storage with a lost reply. Stored but no webhook: inspect destination scope/event types/routing and the delivery queue. HTTP 500/503: wait for retry or repair your receiver. HTTP 401/403: fix receiver authorization/signing configuration, then explicitly retry.',
          'Repeated timeout: make the receiver accept promptly and process expensive work asynchronously after durable acceptance. Dead letter: inspect the terminal reason and payload expiry before replay. A missing payload cannot be reconstructed by claiming the old event was sent again. Worker/database outages leave durable work for lease recovery; remote duplicates remain possible.',
        ],
      },
    ],
  },

  {
    slug: 'getting-started',
    title: 'Send your first Secure V2 reading',
    summary:
      'From a new workspace to stored telemetry, with ESP32 hardware or a Node.js computer.',
    sections: [
      {
        title: '1. Account and device',
        paragraphs: [
          'Create an account and verify your email if requested. Sign in to Overview, then open Devices → Add device. A device represents one independent sender and has a private Secure V2 credential. New customer devices are enrolled automatically; an unavailable rollout produces an explicit error rather than falling back to an older protocol.',
          'An owner or admin can create devices. Viewers can inspect data. If device capacity is reached, review usage and Billing before adding more.',
        ],
      },

      {
        title: '2. Schema and example',
        paragraphs: [
          'Open Schema for your device. Start with the environmental example: temperature −40..125°C in 0.1°C steps, humidity 0..100% in 0.1% steps, and active boolean. These declared fixed-point ranges trade precision for size; humidity 61.25 becomes 61.3. Choose Float32/Float64 instead when the declared floating format is required.',
          'Publish an unused schema slot. Slots 0..15 are immutable: changing a layout requires another slot and newly generated firmware. The dashboard reports payload and secure frame sizes separately.',
        ],
      },

      {
        title: '3. Choose a platform and download',
        paragraphs: [
          'In Schema → Download your starter project, choose ESP32 / PlatformIO or Node.js / local computer. No physical hardware is required for Node. Select the published slot and download the private ZIP. Keep the entire extracted directory.',
          'ESP32 projects include platformio.ini, src/main.cpp, include/struct_config.h, include/struct_packet.h, schema.json, and pinned SDK source in lib/Struct. Node projects include send.cjs, sample.json, schema.json, private-config.json, and the actual SDK/encoder in sdk/. No snippets need to be assembled manually.',
          'One credential must have one sender and one counter owner. Create a separate device for a laptop and a physical board. Never flash the same private project to multiple boards.',
        ],
      },

      {
        title: '4. ESP32: configure, build and upload',
        paragraphs: [
          'Install VS Code and the PlatformIO IDE extension. Open the extracted project folder. Edit only WIFI_SSID and WIFI_PASSWORD in include/struct_config.h; the device wire ID, secret and bootstrap token are already filled in. Select the actual board model. Keep private configuration out of Git.',
          'Connect the board with a data-capable USB cable. Open the PlatformIO terminal, identify the serial port, build, upload, then open the serial monitor. Replace COM3 below with your port (for example /dev/ttyUSB0). Close other serial monitors before uploading. Some boards require holding BOOT during upload.',
          'First provisioning needs Wi-Fi, time synchronization for certificate validation, and authenticated HTTPS. Telemetry uses ingest.usestruct.com UDP 8081, already configured by the SDK. You do not configure Supabase, gateway servers or internal master keys. Modify the sample assignments in src/main.cpp after the first reading works.',
        ],
        code: 'pio device list\npio run\npio run -t upload --upload-port COM3\npio device monitor --baud 115200 --port COM3',
      },

      {
        title: '5. Node.js: send without hardware',
        paragraphs: [
          'Install Node.js 22 or newer, extract the Node starter, and run the commands below from that directory. No npm packages are required. Edit sample.json to change values without altering the schema. The computer must reach HTTPS provisioning and UDP ingestion.',
          'Expected output includes status committed after an authenticated receipt; unknown means storage could not be established from the receipt. Counter files must survive restarts. After counter-state loss, rotate the credential and export a replacement starter; never reset the sequence manually.',
        ],
        code: 'node --version\nnode send.cjs',
      },

      {
        title: '6. Verify the stored reading',
        paragraphs: [
          'Open Overview and select this device. Latest stored event shows decoded JSON and its timestamp; the chart appears for numeric readings. Confirmed ESP32 result 3 or Node status committed proves authenticated database acceptance. Result 2 / sent means only the local send completed. Result 4 / unknown can mean the receipt was lost even if storage succeeded.',
          'Getting Started is completed by committed telemetry for the workspace and does not reappear after retention deletes history. Downloads are recorded separately; configuration is a manual acknowledgment, not proof that firmware was uploaded. Use Getting Started in the sidebar to revisit the guide.',
          'A database receipt does not prove webhook delivery. Inspect Deliveries for downstream outcomes. If no data appears, open Troubleshooting and Diagnostics for the same device.',
        ],
      },
    ],
  },

  {
    slug: 'devices',
    title: 'Devices and activity',
    summary:
      'Identity, activity, reporting intervals and safe credential management.',
    sections: [
      {
        title: 'Identity and credentials',
        paragraphs: [
          'The dashboard UUID identifies the device record; the Secure V2 wire ID is the numeric identity in packets. The root secret authenticates and encrypts packets; the one-time bootstrap token initializes sequence reservation through HTTPS. Neither a UUID nor wire ID is a secret. Never share the root secret, token or private starter ZIP.',
          'Rotate secrets from Schema when a credential is exposed or counter state is lost. Rotation issues a new wire ID and offers an explicit old-credential grace period. Immediate revocation stops that prior credential; this is not a universal device-disable switch. Deleting a device is destructive and requires confirmation.',
        ],
      },

      {
        title: 'Activity is not connectivity',
        paragraphs: [
          'Active describes recent observed device activity, not a live connection. Current Secure V2 last-seen updates follow committed telemetry; historical last-seen values may also reflect authenticated connections and are not sufficient proof to complete onboarding. Inactive means a device with prior activity has exceeded three configured reporting intervals, with a minimum five-minute window. Without an expected interval the threshold is five minutes. Never connected means no durable last-seen or committed-reading evidence is available. If only historical committed-reading evidence remains without a last-seen timestamp, the status is conservatively Inactive.',
          'Set the expected reporting interval in the device setup guide. This is a status-display expectation, not a command that changes firmware. A batch sample interval describes spacing between readings, not how frequently a device transmits. Retention deletes telemetry history but does not erase last_seen or the first-reading milestone.',
        ],
      },

      {
        title: 'More devices',
        paragraphs: [
          'Use the search to match names, identifiers, tags or activity status. Open device is the main card action; setup appears for a new sender, and secondary actions are under More actions. The fleet-management guide covers Secure V2 bulk registration, groups, tags and manufacturing manifests when fleet management is enabled. Historical fleet-profile tooling remains compatibility-only.',
        ],
      },
    ],
  },

  {
    slug: 'schemas',
    title: 'Schemas, precision and immutable slots',
    summary: 'Define exactly how firmware and the gateway agree on a reading.',
    sections: [
      {
        title: 'Supported fields',
        paragraphs: [
          'Current optimized schema encoding supports boolean; signed and unsigned integers with 1..64-bit widths; Float16, Float32 and Float64; enums; fixed/range decimals; bitsets; bounded UTF-8 strings and bounded binary bytes. Timestamps can use unsigned 64-bit milliseconds with a documented epoch.',
          'Float64 uses real IEEE binary64. Wide integers must retain exact decimal values, not JavaScript numbers beyond its safe integer range. Stored wide integers use tagged decimal strings, and binary fields use tagged hex. Nested structures, optional/null fields, variable-length arrays and generic repeated structures are not implemented.',
          'Strings and binary fields require maxBytes 1..256. Their fixed record reserves two length bytes plus the declared capacity, with zero padding; this simplifies embedded buffers but can cost more than variable-length formats. Invalid UTF-8, excessive lengths and malformed padding are rejected.',
        ],
      },

      {
        title: 'Precision and generated serializers',
        paragraphs: [
          'Fixed-point fields require explicit minimum, maximum and step. Encoding rounds to that grid and fails outside the declared range unless clamping was explicitly selected. Generated serializers check buffers and ranges before transmitting. Do not interpret optimized as automatically lossless.',
          'Publish only to unused slots. Download a new project after choosing a different slot. Previously published layouts and devices retain their original meaning. A schema version in historical firmware is different from a Secure V2 slot. Advanced copied historical layouts are a migration mechanism, not the recommended new-device flow.',
        ],
      },
    ],
  },

  {
    slug: 'secure-v2',
    title: 'Secure V2 and delivery guarantees',
    summary:
      'Authentication, counters, receipts and batching without guessing about delivery.',
    sections: [
      {
        title: 'Authenticated encryption',
        paragraphs: [
          'Secure V2 uses ChaCha20-Poly1305: a nine-byte header plus sixteen-byte authentication tag around the encoded sensor payload. Application datagrams exclude UDP/IP headers. The production gateway requires authentication; Protocol Lab plaintext is isolated benchmarking and is not an ingestion mode.',
          'Each device has its own root secret and wire ID. Monotonic sequence reservation prevents nonce reuse; the gateway maintains durable replay state. Preserve NVS / counter.json across reboots and do not clone or restore old state. After state loss, rotate credentials. Do not disable certificate validation or invent a starting sequence.',
        ],
      },

      {
        title: 'Confirmed and unconfirmed delivery',
        paragraphs: [
          'Unconfirmed sends once and provides no storage receipt. Confirmed requests an authenticated 21-byte application receipt after telemetry and its outbox work commit. The SDK performs bounded retries of identical frame bytes; unknown after the deadline is ambiguous, not proof of failure.',
          'Receipts confirm database acceptance and eligible outbox enqueue. They do not promise execution by your downstream application. Batching groups fixed-size readings with per-packet sequencing and receipts; splitting requires separate packets, counters and confirmations. See the SDK method documentation for its configured frame limits.',
        ],
      },
    ],
  },

  {
    slug: 'sdks',
    title: 'SDKs and supported platforms',
    summary:
      'Use the pinned starter rather than assembling cryptographic packets yourself.',
    sections: [
      {
        title: 'Current Secure V2 implementations',
        paragraphs: [
          'Secure V2 is implemented in C/C++ and Node.js. The complete Arduino ESP32 / PlatformIO starter bundles pinned C source and generated headers. The generic C interface accepts platform callbacks; POSIX and ESP-IDF examples exist in the repository but are not additional dashboard starter choices.',
          'The Node sender uses the same real packet and counter SDK and the canonical packed encoder. Its confirmed output is a storage result. Do not substitute the historical Python/Rust SDKs: they currently implement older protocol generations, not Secure V2.',
          'ESP32 Dev Module is the default generated board. ESP32-C3 is also selectable, but requires its matching RISC-V toolchain. Host compilation and local gateway simulation are not physical-board qualification.',
        ],
      },

      {
        title: 'Build requirements and updates',
        paragraphs: [
          'The generated PlatformIO project pins pioarduino platform-espressif32 55.03.312-1 and uses Arduino framework at serial monitor speed 115200. Install dependencies through PlatformIO and keep the private configuration excluded from Git. Node requires Node.js 22+ and uses built-in modules.',
          'Export again after credential rotation or a new immutable slot. Merge your application changes carefully: regeneration replaces generated files. Keep the bundled SDK and serializer together. The repository source and docs/SDK-SUPPORT.md provide compatibility details.',
        ],
      },
    ],
  },

  {
    slug: 'telemetry',
    title: 'Telemetry, history and retention',
    summary: 'Understand what is stored and what a successful send proves.',
    sections: [
      {
        title: 'Readings and history',
        paragraphs: [
          'Overview loads at most fifty retained samples for the selected device, not the entire telemetry history. Live updates supplement that bounded query; if realtime is unavailable use Refresh. Stored JSON is gateway-decoded data, while the chart joins numeric samples without inventing intervening readings.',
          'A newly added device has its own setup guidance even when workspace onboarding is already complete. An inactive existing device needs troubleshooting rather than first-time account onboarding. Empty history can mean retention, not that a device never worked.',
        ],
      },

      {
        title: 'Retention',
        paragraphs: [
          'Existing retention is one day for Free, seven days for Flexible, and thirty days for Pro/Scale. Account Billing and current entitlements remain authoritative. Retention removes old sample rows but preserves workspace completion and durable device activity evidence.',
          'Keep long-term history in your own downstream system where necessary. A webhook that succeeded before retention is separate from the sample still being visible in Overview.',
        ],
      },
    ],
  },

  {
    slug: 'webhooks',
    title: 'Webhooks and downstream integrations',
    summary:
      'Configure HTTPS receivers and inspect durable telemetry delivery.',
    sections: [
      {
        title: 'Configure a destination',
        paragraphs: [
          'Open Destinations, provide an HTTPS receiver and choose the applicable device/event types. Owners and admins can configure destinations; viewers inspect permitted metadata. Scale routing uses actual entitlement checks. Invalid or nonmatching routing conditions do not send telemetry.',
          'Telemetry inserts enqueue eligible delivery jobs transactionally. The gateway outbox worker sends them with bounded attempts, backoff and deadlines. Inspect Deliveries and its attempt history; dead jobs can be explicitly replayed within the implemented replay allowance. Connection/disconnection events use separate best-effort behavior.',
        ],
      },

      {
        title: 'Verify and deduplicate',
        paragraphs: [
          'Use the destination signing secret to verify x-struct-signature over the exact raw HTTP request body before parsing or acting. Signature is sha256= followed by SHA-256 HMAC in hexadecimal. Compare equal-length digests in constant time. body.id / x-struct-event-id is a stable identity for receiver-side transactional deduplication.',
          'Return HTTP 2xx after your receiver has safely handled the event. Delivery is at least once with bounded attempts: the receiver may commit before Struct observes its response. An authenticated device receipt is not a webhook success. Do not log signing secrets or credential-bearing destination URLs.',
        ],
        code: `// Node.js 22+: verify the exact bytes before parsing. No framework required.

const http = require('node:http');

const {createHmac, timingSafeEqual} = require('node:crypto');

const secret = process.env.STRUCT_WEBHOOK_SECRET;

if (!secret) throw new Error('Set STRUCT_WEBHOOK_SECRET privately');

http.createServer((req, res) => {

  const parts = []; let size = 0;

  req.on('data', b => { size += b.length; if(size > 1048576) req.destroy(); else parts.push(b); });

  req.on('end', () => {

    const raw = Buffer.concat(parts), signature = req.headers['x-struct-signature'];

    if(typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/i.test(signature)) {res.writeHead(401).end();return;}

    const actual = Buffer.from(signature.slice(7), 'hex');

    const expected = createHmac('sha256', secret).update(raw).digest();

    if(!timingSafeEqual(actual, expected)) {res.writeHead(401).end();return;}

    try {const event = JSON.parse(raw.toString('utf8'));

      // In production: transactionally deduplicate event.id and store/apply it here.

      // This demonstration prints only the event identity; it is not durable processing.

      console.log('Verified event', event.id);

      res.writeHead(204).end();

    } catch {res.writeHead(400).end();}

  });

}).listen(9000, '127.0.0.1');

// A deployed destination requires your HTTPS endpoint; localhost is for local tests.`,
      },
    ],
  },

  {
    slug: 'billing',
    title: 'Account, Billing and limits',
    summary: 'Review actual entitlements and resolve account restrictions.',
    sections: [
      {
        title: 'Usage and plans',
        paragraphs: [
          'Settings → Billing displays the current workspace plan and device usage. Device capacity comes from the subscription/usage system; paid capacity and true-up behavior remain unchanged. A limit error identifies the reached resource and links to Billing. No new telemetry-event, schema or project quota is implied when none is enforced.',
          'Refresh billing clears the previous operation feedback, prevents concurrent refreshes and updates the current state. Free without a subscription is normal. Checkout and the billing portal are separate actions; a synchronization never creates a subscription merely because one is absent.',
        ],
      },

      {
        title: 'Account and support',
        paragraphs: [
          'Owners/admins control write actions; viewers need an authorized teammate for changes. Switch workspaces using the organization selector. Each workspace has separate devices and onboarding evidence.',
          'For unresolved problems contact support@usestruct.com through Settings → Support. Include the device record ID, timestamp, SDK version and sanitized diagnostics, never secrets or private project ZIPs.',
        ],
      },
    ],
  },

  {
    slug: 'troubleshooting',
    title: 'Troubleshooting by symptom',
    summary:
      'Start with observable evidence before rotating credentials or changing schemas.',
    sections: [
      {
        title: 'Cannot build, upload or connect Wi-Fi',
        paragraphs: [
          'Build: open the whole extracted PlatformIO folder and run pio run. Read the first compiler/tool download error; confirm board selection and internet access. C3 needs its RISC-V compiler. Upload: use a data cable, pio device list, the correct USB driver/permissions and an unused serial port; some boards require BOOT.',
          'Wi-Fi: check SSID/password in include/struct_config.h, supported board radio/network and signal. First bootstrap also needs HTTPS and NTP/time for certificates. Do not disable TLS validation. Initialization failure can be Wi-Fi, clock, provisioning token or counter storage; inspect serial output before changing anything.',
        ],
      },

      {
        title: 'No telemetry or authentication failure',
        paragraphs: [
          'Confirm ingest.usestruct.com UDP 8081 is reachable through the network/firewall. Do not use the website HTTP URL as the UDP endpoint. Select the same workspace and device in Overview and Diagnostics.',
          'Verify the exported wire ID/root secret belong to this sender and the firmware uses a published slot for exactly the same schema and record length. Never paste secrets into shared commands or support logs. An authentication failure can indicate wrong credentials, a changed frame or a revoked/expired credential.',
          'Replay/counter failures require preserving durable state. Lost or rolled-back counter state requires credential rotation, not resetting to zero. A one-time bootstrap token cannot safely initialize the same credential twice.',
        ],
      },

      {
        title: 'No receipt / delivery unknown',
        paragraphs: [
          'Unconfirmed mode does not send receipts. With confirmation enabled, allow the SDK bounded deadline/retry policy. If the status is unknown, inspect the latest stored event and diagnostics for this device: telemetry may have committed while the reply was lost.',
          'A receipt can prove storage only if its authentication verifies. Do not count a UDP send, TCP acknowledgment or visible device activity as a database commit. Use the receipt result or a stored telemetry record.',
        ],
      },

      {
        title: 'Stored reading but no downstream result',
        paragraphs: [
          'Open Deliveries. Check destination enabled state, URL, routing match, HTTP response, signature validation and attempt history. A dead job exhausted attempts; replay only after fixing the receiver. Receiver-side deduplication is still required.',
          'An empty chart may indicate nonnumeric fields or expired history. Inspect Latest stored event JSON and retention. If still unresolved, contact support with sanitized evidence and timestamps.',
        ],
      },
    ],
  },

  {
    slug: 'compatibility',
    title: 'Historical firmware compatibility',
    summary: 'Migration notes separated from current Secure V2 onboarding.',
    sections: [
      {
        title: 'Existing devices',
        paragraphs: [
          'Older V1-family framing and historical SDKs remain in the backend/research archive. Customer devices were not queried or changed in production during this overhaul, so active legacy usage is unknown. Local schema and gateway tests preserve compatibility.',
          'Existing firmware tooling is available at /dashboard/compatibility for existing devices with published historical layouts, including during migration. Enroll through Schema, publish an unused slot, download and validate new firmware, then rotate/revoke prior Secure V2 credentials as appropriate. Enrollment alone does not revoke a legacy credential. Coordinate legacy retirement explicitly; do not assume encryption settings can migrate firmware automatically.',
          'Legacy fleet profiles/bulk registration are not Secure V2 enrollment. They are separated from the normal new-device flow; Secure V2 fleet bulk provisioning remains future work. Historical Protocol Lab records are preserved and clearly labeled.',
        ],
      },
    ],
  },
]

export function guideBySlug(slug: string) {
  return GUIDES.find((g) => g.slug === slug)
}
