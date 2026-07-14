# Struct

The ultra-lightweight IoT gateway for battery-constrained fleets. Microcontrollers dump **packed C++ structs** over TCP — Struct authenticates, (optionally) decrypts with ChaCha20, parses with your schema, and routes clean JSON to your cloud.

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

## Monorepo

| Path | Role |
|------|------|
| `/web` | Nuxt — landing, auth, bento dashboard, fleet tags, destinations, schema + ChaCha20, debugger |
| `/tcp-server` | Native `net` TCP ingestion, crypto, webhook fan-out, downlink delivery |
| `/supabase/migrations` | Postgres tables + RLS |
| `test_device.cpp` | ESP32 reference sketch |

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run migrations in order in the SQL editor:
   - `supabase/migrations/001_init.sql`
   - `supabase/migrations/002_fix_devices_rls.sql`
   - `supabase/migrations/003_saas_features.sql` (destinations, tags, encryption, downlinks)
3. Copy Project URL, anon key, and service role key.

### 2. Web (`/web`)

```bash
cp web/.env.example web/.env
# fill SUPABASE_URL + SUPABASE_KEY (anon)
npm --prefix web install
npm run dev:web
```

### 3. TCP server (`/tcp-server`)

```bash
cp tcp-server/.env.example tcp-server/.env
# fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm --prefix tcp-server install
npm run dev:tcp
```

### 4. Device

1. Sign up → **Devices** → create a device (copies a 16-char API key).
2. Optional: add fleet **Tags** (Location, Version, Status) and filter the fleet.
3. **Schema** → add fields matching your packed struct; optionally enable **ChaCha20**.
4. **Destinations** → paste a webhook URL to pipe JSON into your systems.
5. Flash `test_device.cpp` with WiFi, server IP, and API key.
6. **Send Command** on a device to queue an OTA downlink (`set_interval`, `reboot`, or custom hex).

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

Command packing:

| `command_type` | Bytes |
|----------------|-------|
| `set_interval` | `0x01` + `uint32` seconds LE |
| `reboot`       | `0x02` |
| `custom`       | `0xFF` + raw hex |

Type sizes: `float32`=4, `int32`=4, `uint8`=1, `boolean`=1 (`uint8_t` 0/1).

## Design system

- Background `#0F1115`, cards `#1A1D24`, accent `#00FFA3` (cyan→green gradients on marketing)
- UI: Geist · hex/JSON/API keys: Geist Mono (JetBrains Mono fallback)
- Dashboard: fixed-height bento grid (no endless scroll)
