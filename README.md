# Struct

Microcontrollers dump **packed C++ structs** over TCP. Struct turns them into live JSON dashboards — no heap-crushing `ArduinoJson` on the device.

```
ESP32  --[16B api_key + packed LE bytes]-->  tcp-server (:8080)
                                                   |
                                              Supabase (telemetry)
                                                   |
                                              Nuxt dashboard (Realtime)
```

## Monorepo

| Path | Role |
|------|------|
| `/web` | Nuxt app — auth, bento dashboard, schema builder, live debugger |
| `/tcp-server` | Native `net` TCP ingestion + schema-driven binary parser |
| `/supabase/migrations` | Postgres tables + RLS |
| `test_device.cpp` | ESP32 reference sketch |

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/migrations/001_init.sql` in the SQL editor.
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

1. Sign up in the web app → **Devices** → create a device (copies a 16-char API key).
2. **Schema** → add fields matching your packed struct (`float32`, `int32`, `uint8`, `boolean`).
3. Flash `test_device.cpp` with your WiFi, server IP, and API key.
4. Watch telemetry land on the dashboard via Supabase Realtime.

## Wire protocol

```
Offset 0     : 16 bytes ASCII api_key (no NUL)
Offset 16…   : little-endian packed fields in schema order
```

Type sizes: `float32`=4, `int32`=4, `uint8`=1, `boolean`=1 (`uint8_t` 0/1).

## Design system

- Background `#0F1115`, cards `#1A1D24`, accent `#00FFA3`
- UI: IBM Plex Sans · hex/JSON/API keys: JetBrains Mono
- Dashboard: fixed-height bento grid (no endless scroll)
