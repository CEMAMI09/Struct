# Struct

Struct is a binary telemetry gateway for intermittent IoT devices. Devices pack
little-endian payloads, authenticate each frame with HMAC-SHA256, and send TCP or
UDP. The gateway validates the schema and timestamp, stores telemetry in Supabase,
and sends signed JSON webhooks to configured destinations.

The web app generates payload encoders for **C, C++, JavaScript, Python, Rust and
Arduino**. The new [device SDK](sdk/README.md) bundles signing, frame construction,
UDP transport and bounded receipt retries for C/ESP32, Node and Python. Rust is
currently an encoder target, not a full transport SDK. Python currently supports
authenticated plaintext only; C and Node also support payload encryption.

## Current features

Task 2 adds [dependable delivery](docs/DEPENDABLE-DELIVERY.md): transactional
telemetry webhook jobs, delivery history/replay, signed TCP commands, and C/Node
persistent queues using protocol 4. Apply migrations 022–024 before rollout.

The preview's [delivery guarantees](docs/CONTRACT.md),
[wire specification](docs/PROTOCOL.md), and [release gates](docs/RELEASE-GATES.md)
define supported behavior and outstanding production requirements. Frozen public
test vectors live in `sdk/tests/protocol-vectors.json`; run `npm run test:protocol`.
Persistent offline delivery is available through the new C/Node queues; see the
delivery guide for capacity, storage durability and device-identity restrictions.

- **Public site:** interactive multi-language schema sandbox, implementation
  comparisons, benchmark methodology, pricing, signup/login, confirmation, privacy
  and terms. Comparisons distinguish cold connections from persistent sessions.
- **Dashboard:** device presence, live telemetry via Supabase Realtime, charts,
  packet counts and latest parsed payload.
- **Devices:** create/delete, rotate credentials, edit/search tags, offline filters,
  CSV/XLSX imports with previews, and queued commands. Spreadsheet imports are
  browser-only, bounded to 5 MB, and preserve blank-column positions.
- **Profiles:** reusable fleet schemas, identity fields, bulk provisioning and
  Master Fleet Key zero-touch device registration. Current fleet schema version is
  1; changing a profile needs a new profile/key rollout rather than silently
  assigning a new version to the same fleet key.
- **Schema:** float32, int32, uint8, boolean, named bit flags, and fixed char arrays;
  server-validated publication with immutable version history; six encoder targets;
  full SDK and Arduino ZIP downloads; optional ChaCha20-Poly1305 keys.
- **Debugger:** real per-device gateway stages, encrypted packet support, SDK outcome
  correlation, webhook status, byte accounting and sanitized diagnostic bundles.
  Separate simulation, cloud-free gateway/fault tests and production capture.
  Apply migration 025 and follow [debugger setup](docs/DEBUGGER.md).
- **Destinations:** scoped HTTPS webhooks, event subscriptions, HMAC signatures,
  and Scale routing rules. Public-address DNS validation and no redirect following
  prevent requests to private/reserved network addresses.
- **Organizations:** multiple workspaces, owner/admin/viewer permissions and
  Scale team management. Database roles and policies enforce access.
- **Settings:** Stripe subscriptions, portal, usage, credentials, event webhook
  configuration and account preferences.
- **Audit:** Scale infrastructure history, protected from updates/deletes.

The principal dashboard routes are `/dashboard`, `/dashboard/devices`,
`/dashboard/profiles`, `/dashboard/schema`, `/dashboard/debugger`,
`/dashboard/destinations`, `/dashboard/organization`, `/dashboard/settings` and
`/dashboard/audit-logs`.

## Delivery semantics

**Unconfirmed (protocol 2):** one UDP send, no receipt. The SDK can return `sent`
when the local socket accepts the datagram, then the application can sleep. TCP
also accepts v2 frames, but TCP delivery alone does not acknowledge database storage.

**Confirmed UDP (protocol 3):** same frame layout, requesting a signed storage
receipt. The database atomically inserts the replay nonce, telemetry and presence
update. An exact retransmission receives a duplicate receipt without another row
or repeated webhook dispatch. A failed storage transaction does not consume the
nonce. Reusing a nonce for different bytes is rejected.

SDK confirmed defaults: one retry, a 3-second initial wait with jitter, and a
7.5-second total send/wait budget. Retries back off exponentially; callers can
disable retries or shorten the budget. `unknown` means the packet or receipt might
have been lost. It must never be presented as definitely delivered or definitely
lost. See [SDK delivery guidance](sdk/README.md#delivery-and-battery-budget).

A receipt means **telemetry committed**, not webhook delivery. Telemetry webhook
jobs commit in the same transaction and are retried asynchronously. C/Node offer
bounded persistent queues; modem power management remains application-owned.
Network attach, clock synchronization, and radio-tail energy still matter;
smaller packets do not establish measured battery savings.

## Wire protocol

```text
Telemetry (little endian):
[protocol:1][key_id ASCII:16][schema:1][unix seconds:4][nonce:12][payload:N][HMAC:32]

protocol 2 = unconfirmed TCP/UDP
protocol 3 = confirmed UDP telemetry only
schema = 1..255 (0 reserved for v2 device command ACKs)
```

HMAC-SHA256 signs every preceding byte with the literal 64-character API secret,
**not** the decoded hex bytes. `key_id` is public and must be 16 ASCII characters.
Telemetry overhead is 66 bytes, with a default maximum frame size of 1,400 bytes.
Timestamps must be within the configured replay window (60 seconds by default).

Optional encryption replaces the payload region with:

```text
[separate ChaCha nonce:12][ciphertext of unix seconds:4 + payload:N][Poly1305 tag:16]
```

Encryption adds 32 bytes to the unencrypted frame. It uses the separate 32-byte
dashboard encryption key and a separate cryptographically random nonce.

The 69-byte storage receipt is:

```text
[ASCII STRA:4][original frame HMAC:32][status:1][receipt HMAC:32]
status 0 = stored now; status 1 = identical packet already stored
```

Receipt HMAC signs the first 37 bytes. SDKs verify the signature and the original
frame binding before reporting `committed`. V2 UDP sends receive no receipt.
Malformed, unauthenticated, rate-limited, stale and failed packets receive none.

Legacy TCP command envelopes remain:

```text
Downlink: [uint16 LE length][protocol=2:1][command UUID:16][command bytes]
Device ACK: [protocol=2:1][key_id:16][schema=0:1][command UUID:16][result:1][HMAC:32]
```

Commands include set_interval, reboot, and custom bytes. Claims have expiring
leases and can recover after a gateway crash. Marking a command sent cannot
overwrite a concurrent acknowledgment. **The legacy downlink itself is not
signed**; use a protected transport for device control. New UDP SDKs do not execute
these commands.

## Plans and billing

Free includes five devices and one-day retention. Flexible adds paid device
capacity and seven-day retention. Pro adds encryption/downlinks and 30-day
retention. Scale adds teams, routing and audit logs. Enterprise offerings remain
sales-led; this repository does not implement a complete self-service SAML product.

Paid usage uses a billing-period high-water mark. Creating/deleting devices does
not immediately change Stripe subscription quantity. Overage is calculated at
period close; deleting devices does not lower an already-recorded peak. Price IDs
and Stripe subscription data are the billing source of truth. Checkout, portal,
webhook synchronization and bulk provisioning routes remain in `web/server`.
Do not test financial operations against live Stripe credentials.

## Local development

Use Node.js 24, npm, Python 3 for SDK packaging/tests, and a Supabase development
project. C requires a C99 compiler; the supplied crypto adapters use mbedTLS.

```sh
npm ci
npm --prefix web ci
npm --prefix tcp-server ci
cp web/.env.example web/.env
cp tcp-server/.env.example tcp-server/.env
```

Configure Supabase URL, browser publishable/anon key, and server-only service-role
key. Configure Stripe test keys/Price IDs only when testing billing. Both gateway
and web credential encryption need the same `TCP_CREDENTIAL_KEY` (64 hex chars;
the web helper also accepts `NUXT_TCP_CREDENTIAL_KEY`). Never publish server keys.

Apply Supabase migrations in filename order. The local database tests supply
minimal Auth fixtures, built-in UUID generation and a pgcrypto test fixture;
`pg_cron` scheduling is tested separately on Supabase, not emulated by PGlite.

```sh
npm run dev:web
# Separate terminal:
npm run dev:tcp
```

Web: `http://127.0.0.1:3000`. Default gateway ports: TCP 8080, UDP 8081.
Use the SDK sample after creating a device and saving a matching schema. The
obsolete root Arduino sample now forwards to `sdk/c/examples/Telemetry`.

## Upgrade order

1. Apply `020_atomic_telemetry_receipts.sql` and `021_atomic_schema_publication.sql`.
   Gateway-only SECURITY DEFINER functions become service-role-only. Direct schema
   writes become a checked, atomic publication RPC.
2. Drain/replace old gateway processes. Old nonce reservations have no commit
   digest; wait out the replay window before enabling confirmed firmware.
3. Deploy the new web app/gateway and refresh already-open schema editors.
4. Enable confirmed UDP per device application where its energy budget permits.
   Old v2 uplinks keep their wire format. Update optional XDP filters to admit v3.

Historical migrations 002 and 012 were corrected so a fresh installation runs
in order. Existing installations do not need to rerun them. Deployment and live
database migration application are separate from local code/tests.

Replay rows can be purged after `expires_at` plus a small safety margin; keep them
through the entire accepted timestamp window. Configure a maintenance job for
large fleets. Retention of telemetry remains governed by migration 015's hourly job.

## Validation and SDK packaging

```sh
npm test
python -m unittest discover -s sdk/python -v
npm run build:web
python scripts/package-sdk.py
```

`npm test` includes web tests, gateway parser/crypto/replay/transport tests, local
PostgreSQL migrations/transactions/permissions, and Node UDP loss tests.
The static ZIPs in `web/public/sdk` contain no credentials and can be rebuilt.
Detailed C build instructions and API behavior are in [the SDK guide](sdk/README.md).

Optional Rust native parser: `npm --prefix tcp-server run build:native`.
Optional Linux XDP prefilter: see [ops/xdp](ops/xdp/README.md). XDP is only a coarse
size/version filter; HMAC verification remains in the gateway.

## Remaining production work

Hardware-in-loop ESP32/modem validation, physical power-cut and battery measurements,
platform command-journal/socket integration, and a Rust transport SDK remain work.
Signed commands, the telemetry outbox and C/Node queues are local preview features;
apply migrations 022–024 using the dependable-delivery upgrade guide. Tests do not exercise live
Stripe charges or deploy migrations into a production Supabase project.
