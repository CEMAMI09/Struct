# Struct

The ultra-lightweight IoT gateway for battery-constrained fleets. Microcontrollers dump **packed C++ structs** over TCP — Struct authenticates, (optionally) decrypts with ChaCha20, parses with your schema, stores telemetry, and routes clean JSON to your cloud.

```
ESP32  --[16B api_key + packed LE bytes]-->  tcp-server (:8080)
                                                   |
                           ┌───────────────────────┼───────────────────────┐
                           │                       │                       │
                      Supabase               Destinations            Downlinks
                     (telemetry)           (webhooks → AWS /      (pending_commands
                                            Datadog / custom)      pushed on socket)
                           │
                    Nuxt dashboard (Realtime)
```

## Features

### Public site
| Page | What it does |
|------|----------------|
| `/` Landing | Positioning hero, JSON vs Struct math cards, architecture diagram (Edge → Gateway → Cloud), CTAs to sign up / dashboard |
| `/signup`, `/login` | Email/password auth via Supabase |
| `/confirm` | Auth callback after email confirmation |

### Dashboard (`/dashboard/*`, auth required)

| Nav | Route | What it does |
|-----|-------|----------------|
| **Dashboard** | `/dashboard` | Bento overview: device list with online/offline dots, live telemetry line chart (Supabase Realtime), latest parsed JSON packet, online count + packet count for the selected device |
| **Devices** | `/dashboard/devices` | Create/delete devices, copy 16-char API keys, assign fleet **tags** (e.g. Location, Version, Status), text search + “offline in last hour” filter, **Send Command** downlinks (`set_interval`, `reboot`, custom hex) |
| **Destinations** | `/dashboard/destinations` | Add webhook URLs (all devices or one device), enable/disable, delete. TCP server POSTs parsed JSON to each matching destination on every ingest |
| **Schema** | `/dashboard/schema` | Per-device packed field editor (`float32`, `int32`, `uint8`, `boolean`), live `sizeof` + C++ `#pragma pack` preview, **ChaCha20 Edge Encryption** toggle (generates/copies/rotates 64-char hex key) |
| **Debugger** | `/dashboard/debugger` | Client-side packet simulator: picks a device schema, builds a fake frame, shows **raw hex** (API key + payload) and **parsed JSON** without hitting TCP |

Also: sidebar shows TCP ingestion port; header has sign-out.

### Ingestion engine (`/tcp-server`)
- Native Node `net` TCP listener (default `:8080`)
- Looks up device by API key, loads schema, parses little-endian payload
- Optional ChaCha20-Poly1305 decrypt before parse
- Inserts telemetry + updates `last_seen`
- Fan-out to enabled Destinations webhooks
- Delivers pending downlinks on the same socket (and via Supabase Realtime if the socket is still live)

### Device / local tools
| File | Role |
|------|------|
| `test_device.cpp` | ESP32 Arduino sketch — uplink + optional downlink read (`set_interval` / reboot) |
| `dummy-device.js` | Local Node script that fires one packed 25B frame at `127.0.0.1:8080` |

## Monorepo

| Path | Role |
|------|------|
| `/web` | Nuxt 4 app — landing, auth, dashboard pages above |
| `/tcp-server` | TCP ingestion, crypto, webhooks, downlinks |
| `/supabase/migrations` | Postgres tables + RLS (`001`…`003`) |
| `test_device.cpp` / `dummy-device.js` | Edge / local simulators |

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run migrations in order in the SQL editor:
   - `supabase/migrations/001_init.sql` — devices, schemas, telemetry + RLS
   - `supabase/migrations/002_fix_devices_rls.sql` — devices RLS hardening
   - `supabase/migrations/003_saas_features.sql` — tags, encryption columns, destinations, pending_commands
3. Copy Project URL, anon key, and service role key.

### 2. Web (`/web`)

```bash
cp web/.env.example web/.env
# fill SUPABASE_URL + SUPABASE_KEY (anon)
npm --prefix web install
npm run dev:web
```

App: [http://127.0.0.1:3000](http://127.0.0.1:3000) (landing) → sign up → `/dashboard`.

### 3. TCP server (`/tcp-server`)

```bash
cp tcp-server/.env.example tcp-server/.env
# fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm --prefix tcp-server install
npm run dev:tcp
```

### 4. End-to-end smoke path

1. Sign up → **Devices** → create a device (copy the 16-char API key).
2. Optional: add **Tags** and try the fleet search / offline filter.
3. **Schema** → add fields matching your packed struct; optionally enable **ChaCha20**.
4. **Destinations** → paste a webhook URL (optional).
5. Flash `test_device.cpp` (or run `node dummy-device.js` with your API key) against the TCP host.
6. Watch the **Dashboard** update live; use **Debugger** to inspect hex/JSON without hardware.
7. On a device row, **Send Command** to queue an OTA downlink.

## Wire protocol

### Uplink (plaintext)

```
Offset 0     : 16 bytes ASCII api_key (no NUL)
Offset 16…   : little-endian packed fields in schema order
```

### Uplink (ChaCha20-Poly1305)

```
Offset 0     : 16 bytes ASCII api_key
Offset 16    : 12 bytes nonce
Offset 28…   : ciphertext (same length as packed struct)
…            : 16 bytes Poly1305 auth tag
```

### Downlink (server → device, same TCP session)

```
[uint16 LE length][packed command bytes…]
```

| `command_type` | Bytes |
|----------------|-------|
| `set_interval` | `0x01` + `uint32` seconds LE |
| `reboot`       | `0x02` |
| `custom`       | `0xFF` + raw hex |

Type sizes: `float32`=4, `int32`=4, `uint8`=1, `boolean`=1 (`uint8_t` 0/1).

### Destination webhook body

```json
{
  "device_id": "…",
  "device_name": "ESP32 Chicago",
  "timestamp": "2026-07-14T18:00:00.000Z",
  "payload": { "temp": 72.5, "humidity": 45.2 }
}
```

## Design system

- Background `#0F1115`, cards `#1A1D24`, accent `#38B6FF`, muted `#8B93A7`
- UI: Geist · hex / JSON / API keys: Geist Mono (JetBrains Mono fallback)
- Dashboard: fixed-height bento grid (no endless scroll)
