# Struct

Struct is an ultra-lightweight IoT gateway for battery-constrained fleets. Devices send packed C/C++ structs over TCP or UDP instead of verbose JSON. The gateway authenticates each Protocol v2 frame (HMAC), resolves its schema version, optionally decrypts the payload, stores telemetry in Supabase, and routes clean JSON to downstream systems.

```text
ESP32 / MCU
   │  Protocol v2: [proto][key_id][schema][ts][nonce][payload][hmac]
   ▼
Node gateway
   ├── TCP :8080  (streamed frames)
   ├── UDP :8081  (one frame per datagram)
   ├── optional Linux XDP UDP prefilter
   ├── Supabase telemetry + Realtime dashboard
   ├── HTTPS destination webhooks
   └── queued commands returned as TCP downlinks
```

## Current product

### Public website

| Route | Purpose |
| --- | --- |
| `/` | Marketing landing page with the Struct-vs-JSON payload comparison, architecture overview, product capabilities, and signup/dashboard calls to action |
| `/signup` | Supabase email/password account creation |
| `/login` | Supabase email/password login |
| `/confirm` | Supabase email-confirmation callback |

Authenticated users are redirected away from login/signup to the dashboard. Unauthenticated users cannot open `/dashboard/*`.

### Dashboard

| Navigation | Route | Current behavior |
| --- | --- | --- |
| Dashboard | `/dashboard` | Fleet overview, online/offline state, selected-device telemetry chart, packet count, and latest parsed packet; telemetry updates through Supabase Realtime |
| Devices | `/dashboard/devices` | Create, bulk import, and delete devices; rotate or copy 16-character API keys; edit tags; search/filter the fleet; filter devices offline for an hour; and queue downlink commands |
| Destinations | `/dashboard/destinations` | Create, enable, disable, scope, and delete HTTPS webhook destinations; destinations can target every device or one device |
| Schema | `/dashboard/schema` | Build a packed per-device schema, see byte size and generated C++, publish immutable schema versions, download an ESP32/C++ header, and manage optional ChaCha20-Poly1305 encryption |
| Debugger | `/dashboard/debugger` | Generate a client-side test frame from a device schema and inspect its raw hexadecimal wire representation and parsed JSON without sending TCP traffic |
| Organization | `/dashboard/organization` | Rename, create, switch, leave, or delete workspaces; inspect members and manage owner/admin/viewer roles when the plan allows it |
| Settings | `/dashboard/settings` | Billing, API Keys, Webhooks, and Account tabs for viewing live Stripe capacity, opening the Customer Portal, rotating device credentials, configuring signed event webhooks, and managing account preferences |
| Audit Log | `/dashboard/audit-logs` | Scale-only immutable history for device, schema, and destination inserts/updates/deletes, including previous/new state and actor |

The dashboard is responsive, has a mobile navigation drawer, displays the active workspace/role, and treats viewers as read-only.

### Device management

- Every device receives a random 16-character API key.
- Device records belong to an organization.
- Bulk imports accept CSV or XLSX files parsed in the browser. Imported devices require an organization-unique MAC address.
- Tags are editable key/value metadata and are searchable from the Fleet page.
- `last_seen` drives online/offline display and filtering.
- Creating a device also creates its initial empty schema and schema-history entry.
- Supported field types are `float32`, `int32`, `uint8`, `boolean`, and `flags` (up to 8 packed booleans per byte).
- Schema changes publish a new version so old firmware can continue sending its original version byte.
- Pro and Scale organizations can enable or rotate per-device ChaCha20-Poly1305 keys.
- Pro and Scale organizations can queue `set_interval`, `reboot`, or custom hexadecimal downlinks.

### Bulk device imports

The Fleet page provides a downloadable CSV template and a drag-and-drop importer:

1. CSV/XLSX parsing and row validation happen in the browser.
2. The required columns are `Device Name`, `MAC Address`, and `Tags`.
3. MAC addresses are normalized to 12 lowercase hexadecimal characters and must be unique within the organization.
4. The preview endpoint checks conflicts and obtains a Stripe invoice preview when more paid capacity is required.
5. The user explicitly confirms the estimated proration before the import proceeds.
6. The server uses a short-lived, payload-bound quote, idempotent Stripe quantity update, and atomic Postgres RPC to create devices and their initial schemas.

Imports are limited to 1,000 rows. If the database insert fails after Stripe capacity is raised, the server attempts to restore the previous Stripe quantity.

### Organizations and permissions

Struct is organization-scoped and supports multiple workspaces per account.

| Role | Access |
| --- | --- |
| Owner | Full read/write access, role management, member removal, and workspace deletion |
| Admin | Read/write access to organization resources and billing actions |
| Viewer | Read-only access to devices, schemas, telemetry, and other permitted organization data |

Team invitations and role management require Scale. A teammate must already have a Struct account before being added by email. Database RLS and RPCs enforce organization membership and writer/owner boundaries; UI hiding is not the security boundary.

## Plans, entitlements, and retention

The total device allowance is always:

```text
5 free devices + Stripe subscription quantity
```

The values below reflect the current Settings UI. Stripe Price objects remain the billing source of truth and must be configured to match this presentation.

| Plan | Displayed price | Starting paid quantity | Starting total allowance | Capabilities | Retention |
| --- | ---: | ---: | ---: | --- | ---: |
| Developer | $0 | 0 | 5 | Dashboard, basic webhooks, live debugger | 1 day |
| Flexible | $5/month | 5 | 10 | Developer features, automatic device scaling | 7 days |
| Pro | $49/month | 150 | 155 | Flexible features, ChaCha20 encryption, device downlinks | 30 days |
| Scale | $249/month | 1,000 | 1,005 | Pro features, team RBAC, immutable audit logs, logical webhook routing | 30 days |
| Enterprise | Contact sales | Custom | Custom | The UI advertises SAML SSO, dedicated L4 ingestion ports, and custom SLAs; these are sales-led offerings, not self-service features in this repository | Custom |

The pricing UI displays incremental rates of `$1.00`, `$0.50`, and `$0.20` per paid device/month for Flexible, Pro, and Scale respectively.

Entitlements are checked in the Vue UI and enforced in Postgres triggers/functions to prevent direct API bypass. When an organization loses Scale, existing destination routing rules are ignored and webhooks revert to unconditional delivery. Telemetry retention is enforced hourly through `pg_cron`.

## Stripe billing

### Checkout

Paid subscriptions use Stripe Checkout in `subscription` mode with one recurring line item:

- Flexible starts at quantity `5` and cannot be reduced below `5`.
- Pro starts at quantity `150` and cannot be reduced below `150`.
- Scale starts at quantity `1000` and cannot be reduced below `1000`.
- Checkout allows the customer to increase quantity above the floor.
- Quantity means paid devices in addition to the five free devices.

The Checkout success URL contains `{CHECKOUT_SESSION_ID}`. On return, the app retrieves that session server-side and synchronizes the organization immediately. This provides a local-development fallback when webhook delivery is unavailable. Existing paid subscriptions are updated in place when changing tiers so upgrades do not create a second subscription or discard paid quantity above the new tier's floor.

### Automatic scaling

Paid plans track a monthly **high-water mark** of active devices:

- Device create and bulk import update the current billing period peak — they do **not** mutate Stripe subscription quantity mid-cycle.
- Device delete does **not** reduce the period peak or trigger proration invoices.
- At period close, Struct creates **one** Stripe invoice item for overage above the plan floor (`peak_paid_quantity - included_paid_quantity`).
- Free organizations have a hard cap of five devices.

The Stripe Customer Portal supports plan changes, payment methods, invoices, and cancellation — not mid-cycle quantity edits.

### Customer Portal

**Manage in Stripe** creates a Stripe Customer Portal session. Struct maintains a portal configuration that:

- allows payment method, billing address, email, and tax ID updates;
- displays invoice history;
- allows cancellation;
- allows switching among Flexible, Pro, and Scale;
- allows quantity changes with the plan-specific minimums `5`, `150`, and `1000`;
- applies prorations to subscription updates.

Portal plan changes are mapped back to tiers using the current Stripe Price ID, while quantity and cancellation changes are synchronized by webhook. The dashboard also pulls the live active subscription from Stripe on load, and the Billing tab provides a **Refresh** action. When legacy duplicate subscriptions exist, Struct keeps the active subscription with the highest billed quantity and cancels lower-quantity siblings.

### Webhooks

Endpoint:

```text
POST /api/stripe/webhook
```

The endpoint requires the unmodified request body and verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`. It handles:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

For local development:

```bash
stripe login
stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook
```

Copy the CLI's `whsec_...` value into `web/.env` as `STRIPE_WEBHOOK_SECRET`, then restart Nuxt. Keep the listener running while testing. Stripe test and live data are isolated: `sk_test_...` keys must use Price IDs created in test mode, and live keys must use live Price IDs.

For production, create a Stripe webhook endpoint at:

```text
https://your-domain.example/api/stripe/webhook
```

Subscribe it to the four events above and use that endpoint's signing secret in the deployed environment.

## Ingestion gateway

The gateway listens on:

| Transport | Default port | Framing |
| --- | --- | --- |
| TCP (`server.js`) | `TCP_PORT=8080` | Length is derived from schema; multiple frames may share a connection |
| UDP (`udp.js`) | `UDP_PORT=8081` | Exactly one Protocol v2 frame per datagram (no trailing bytes) |

Shared Protocol v2 processing lives in `tcp-server/ingest.js`. For each authenticated frame it:

1. reads the protocol byte, public `key_id`, and schema version;
2. loads the device and matching immutable schema;
3. verifies HMAC-SHA256 and reserves the durable replay nonce;
4. optionally verifies/decrypts ChaCha20-Poly1305;
5. parses the packed little-endian payload (JS parser, or optional Rust napi-rs);
6. inserts telemetry and updates `last_seen`;
7. asynchronously fans out matching destination webhooks;
8. on TCP, delivers queued downlinks on the same socket.

UDP does **not** emit `device.connected` / `device.disconnected` webhooks (no connection lifecycle). After a valid UDP uplink the gateway remembers the authenticated `(address, port)` briefly for future ACK/downlink targeting.

### Flags fields

A `flags` schema field packs up to eight named booleans into one byte:

```json
{
  "name": "status",
  "type": "flags",
  "bits": [
    { "name": "motor_active", "bit": 0 },
    { "name": "door_open", "bit": 1 }
  ]
}
```

Parsed JSON nests booleans under the group name (`status.motor_active`). Generated C++ headers expose a backing `uint8_t` plus `#define` masks — not compiler-dependent bitfields.

### Native parser (optional)

`tcp-server/parser-native.js` tries the napi-rs binding under `tcp-server/native-parser/` and falls back to `parser.js` with a startup warning. Build when a Rust toolchain is available:

```bash
npm --prefix tcp-server run build:native
```

Parity tests: `node tcp-server/test-parser-parity.js`.

### Linux XDP UDP prefilter (optional)

`ops/xdp/` contains a Linux-only eBPF/XDP program that drops fragmented or obviously malformed Protocol v2 UDP datagrams before Node sees them. It does **not** verify HMAC, decrypt, or validate schemas. macOS cannot attach XDP — use a Linux host/VM/CI. See [`ops/xdp/README.md`](ops/xdp/README.md).

### Ingestion protections

- Per-IP connection/datagram limit: 10/second by default.
- Per-key_id payload limit: 50 payloads/minute by default.
- Rate-limited TCP devices receive the custom downlink code `ff e1` before disconnect.
- Frame timestamps must be within `TCP_REPLAY_SKEW_SEC` (default 60 seconds).
- Duplicate nonces are rejected via Supabase durable replay RPC.
- Destination requests time out after eight seconds.
- UDP oversize / trailing-byte datagrams are dropped before auth.

TCP rate-limit state is in memory (per process). Replay nonces are durable in Postgres.

### Destination routing

Basic destinations receive every parsed payload in scope. Scale can add one payload rule using:

```text
==  !=  >  >=  <  <=
```

Missing keys and invalid rules fail closed. Numeric comparisons coerce both sides to numbers. A destination can apply to all devices in an organization or one selected device.

Telemetry destination request example:

```json
{
  "type": "telemetry.received",
  "device_id": "00000000-0000-0000-0000-000000000000",
  "device_name": "ESP32 Chicago",
  "timestamp": "2026-07-14T18:00:00.000Z",
  "payload": {
    "temperature": 72.5,
    "humidity": 45.2
  }
}
```

Destinations can subscribe to `telemetry.received`, `device.connected`, and `device.disconnected`. Requests include `Content-Type: application/json`, `User-Agent: Struct-Gateway/0.1`, `X-Struct-Destination`, and `X-Struct-Event`.

Every destination has a secret used to sign the exact serialized request body with HMAC-SHA256:

```text
X-Struct-Signature: sha256=<hex digest>
```

Receivers should compute the signature from the raw body and compare it with a timing-safe equality function before parsing JSON.

## Wire protocol

### Protocol v2 (required)

All uplinks use authenticated Protocol v2 frames. Legacy plaintext API-key headers are rejected.

**Telemetry uplink**

```text
Offset 0       1 byte    protocol version (2)
Offset 1      16 bytes   public key_id (ASCII)
Offset 17      1 byte    schema version (1–255; 0 reserved for ACK)
Offset 18      4 bytes   uint32 LE Unix timestamp
Offset 22     12 bytes   nonce
Offset 34...   N bytes   payload (plaintext struct or ChaCha20 region)
Final 32      32 bytes   HMAC-SHA256(secret, preceding bytes)
```

The API secret is never transmitted on the wire. Devices authenticate with `HMAC-SHA256(api_secret, frame_body)`.

**ACK uplink** (schema version `0`)

```text
[1B protocol=2][16B key_id][1B 0][16B command_id][1B result_code][32B hmac]
```

**Downlink**

```text
[uint16 LE length][1B downlink_protocol=2][16B command_id][command bytes]
```

Commands move `pending → claimed → sent → acknowledged`. A socket write alone does not mark delivery.

### Plaintext payload (inside v2 frame)

### Encrypted uplink

```text
Offset 0      16 bytes   ASCII API key
Offset 16      1 byte    schema version
Offset 17     12 bytes   ChaCha20-Poly1305 nonce
Offset 29...   N bytes   ciphertext
Final 16      16 bytes   Poly1305 authentication tag
```

The decrypted plaintext is:

```text
[4-byte uint32 LE Unix timestamp][packed struct]
```

### Downlink

```text
[uint16 LE command length][command bytes]
```

| Command | Payload |
| --- | --- |
| `set_interval` | `0x01` followed by `uint32` seconds, little-endian |
| `reboot` | `0x02` |
| `custom` | `0xFF` followed by user-supplied hexadecimal bytes |

Packed type sizes: `float32=4`, `int32=4`, `uint8=1`, `boolean=1`, `flags=1`.

## Repository layout

| Path | Purpose |
| --- | --- |
| `web/` | Nuxt 4 application, dashboard, Supabase browser access, and server-side Stripe routes |
| `tcp-server/` | Node TCP/UDP ingestion, shared Protocol v2 processor, parsers, crypto, rate limits, webhooks, downlinks |
| `tcp-server/native-parser/` | Optional napi-rs Rust payload parser |
| `ops/xdp/` | Linux XDP UDP prefilter sources and load/unload scripts |
| `supabase/migrations/` | Database schema, RLS, RPCs, billing fields, entitlements, audit logs, and retention |
| `test_device.cpp` | ESP32/Arduino plaintext uplink and downlink example |
| `dummy-device.js` | Local Node device simulator (`TRANSPORT=tcp\|udp`) |

### Main technology

- Nuxt 4, Vue 3, TypeScript, and Tailwind CSS
- Papa Parse and SheetJS for browser-side CSV/XLSX imports; Vitest for web tests
- Supabase Auth, Postgres, Row Level Security, Realtime, and `pg_cron`
- Stripe Checkout, Billing, Customer Portal, and signed webhooks
- Node.js TCP + UDP gateway with optional Rust parser and Linux XDP

## Local setup

### Prerequisites

- Node.js and npm
- A Supabase project
- A Stripe account or sandbox
- Stripe CLI for local webhook forwarding

### 1. Install dependencies

```bash
npm --prefix web install
npm --prefix tcp-server install
```

### 2. Apply Supabase migrations

Run every migration in filename order:

| Migration | Purpose |
| --- | --- |
| `001_init.sql` | Initial devices, schemas, telemetry, and RLS |
| `002_fix_devices_rls.sql` | Device RLS hardening |
| `003_saas_features.sql` | Tags, encryption fields, destinations, and pending commands |
| `004_schema_versioning.sql` | Schema version column and immutable history |
| `005_organizations_rbac.sql` | Organizations, membership roles, organization ownership, and RLS |
| `006_org_member_rpcs.sql` | Member listing and add-by-email RPCs |
| `007_fix_org_create_rls.sql` | Atomic organization creation under RLS |
| `008_leave_organization.sql` | Workspace leave behavior |
| `009_remove_member_owner_only.sql` | Owner-only removal of other members |
| `010_destination_routing_rules.sql` | Optional logical destination rules |
| `011_audit_logs.sql` | Immutable infrastructure audit trail |
| `012_stripe_billing.sql` | Subscription tiers and Stripe quantity fields |
| `013_rename_studio_to_scale.sql` | Backward-compatible Studio-to-Scale rename |
| `014_subscription_entitlements.sql` | Database-enforced plan capabilities |
| `015_telemetry_retention.sql` | Tier-based retention and hourly `pg_cron` cleanup |
| `016_bulk_device_upload.sql` | Organization-unique MAC addresses, short-lived import quotes, and atomic bulk device creation |
| `017_settings_webhook_security.sql` | Selectable webhook event types and per-destination HMAC signing secrets |
| `018_protocol_v2_security_billing.sql` | Protocol v2 credentials, durable replay nonces, ACK downlinks, monthly usage true-up |

Migration 015 creates the `pg_cron` extension and schedules `purge-expired-telemetry` at minute 15 of every hour. The project/database user applying it must be allowed to create and schedule cron jobs.

### 3. Configure the web app

```bash
cp web/.env.example web/.env
```

Set:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

NUXT_PUBLIC_TCP_HOST=127.0.0.1
NUXT_PUBLIC_TCP_PORT=8080

STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_FLEXIBLE=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_SCALE=price_...

# 32-byte hex key for encrypting device API secrets at rest (gateway + web must match)
TCP_CREDENTIAL_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
NUXT_TCP_CREDENTIAL_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` are server-only secrets. Never expose them through `runtimeConfig.public`, commit them, or place real values in `.env.example`.

Create one recurring Stripe Price for each paid plan. Quantity represents additional paid devices, not the five free devices. Use test-mode prices with test keys.

### 4. Configure the TCP gateway

```bash
cp tcp-server/.env.example tcp-server/.env
```

Set:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TCP_PORT=8080
UDP_PORT=8081
MAX_FRAME_BYTES=1400
TCP_IP_CONN_LIMIT_PER_SEC=10
TCP_PAYLOAD_LIMIT_PER_MIN=50
TCP_REPLAY_SKEW_SEC=60
TCP_CREDENTIAL_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

The gateway requires the service-role key because hardware devices do not have Supabase user sessions. Keep the gateway private and protect its environment.

### 5. Start local services

Terminal 1:

```bash
npm run dev:web
```

Terminal 2:

```bash
npm run dev:tcp
```

Terminal 3:

```bash
stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

### 6. End-to-end smoke test

1. Sign up and confirm the account.
2. Open Devices and create a device.
3. Copy its 16-character API key.
4. Open Schema, add fields matching the packed firmware struct, and save.
5. Optionally add a Destination.
6. Create/rotate the device to obtain `KEY_ID` + `API_SECRET`, then put them into `dummy-device.js` or firmware.
7. Start the gateway and send a TCP or UDP frame (`TRANSPORT=udp node dummy-device.js`).
8. Confirm the Dashboard receives telemetry and `last_seen` changes.
9. Use Debugger to compare generated hex and parsed JSON.
10. On Pro or Scale, queue a command and confirm the device receives the downlink.
11. In Stripe test mode, subscribe with a test card and confirm Settings updates through the success sync/webhook.
12. Import the CSV template from Devices and confirm the preview, capacity, and created device count.
13. Send a webhook event and verify `X-Struct-Signature` against the raw request body.

## Commands

```bash
# Web development
npm run dev:web

# Production web build
npm run build:web

# TCP development with nodemon
npm run dev:tcp

# TCP production process
npm run start:tcp

# Web unit tests
npm --prefix web test

# Gateway unit-style scripts
npm --prefix tcp-server test
# or individually:
node tcp-server/test-parser.js
node tcp-server/test-parser-parity.js
node tcp-server/test-udp.js
node tcp-server/test-crypto.js
node tcp-server/test-replay.js
node tcp-server/test-rateLimit.js
node tcp-server/test-webhooks.js

# Optional native parser (requires Rust + napi-rs toolchain)
npm --prefix tcp-server run build:native

# Optional Linux XDP attach
# sudo ./ops/xdp/load.sh

# Send a local sample frame (TCP or UDP)
KEY_ID=… API_SECRET=… node dummy-device.js
TRANSPORT=udp KEY_ID=… API_SECRET=… node dummy-device.js
```

## Security notes

- Organization access is protected with Supabase RLS plus server-side role checks.
- Stripe webhook signatures are verified against the raw body.
- Outbound destination webhooks are signed with a per-destination HMAC-SHA256 secret.
- Checkout session synchronization verifies authentication and organization writer access.
- Service-role and Stripe secret keys must stay server-side.
- ChaCha20-Poly1305 supplies payload confidentiality/integrity; timestamps and durable Supabase nonce tracking mitigate replay across gateway restarts.
- Protocol v2 never sends the API secret on the wire; devices authenticate frames with HMAC-SHA256.
- Downlinks require device ACK before a command is marked acknowledged.
- XDP is coarse UDP filtering only; Protocol v2 HMAC remains the authentication boundary.
- The gateway is not TLS. Use a private network, VPN, secure tunnel, or TLS-terminating proxy when confidentiality of payloads in transit is required.
- Destination URLs are user-configured outbound requests; production deployments should add an SSRF policy appropriate to their network.

## Design

- Background: `#0F1115`
- Cards: `#1A1D24`
- Accent: `#38B6FF`
- Muted text: `#8B93A7`
- UI font: Geist
- Monospace content: Geist Mono with JetBrains Mono fallback
