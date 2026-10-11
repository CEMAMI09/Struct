# First ESP32 sample: measured Secure V2 benchmark

This benchmark uses the exact original values and schema: `temp` float32 23.5,
`humidity` float32 61.25, and `is_active` boolean true. Original plaintext is
`00 00 BC 41 00 00 75 42 01`. The V1 baseline supplied by the user is **unencrypted**;
the comparison is a byte-volume comparison, not an equivalent-security comparison.

## What actually runs

`scripts/benchmark-secure-v2-esp32.cjs` calls the production
`generateV2PacketHeader` schema generator, compiles its real generated serializers
with `sdk/c/benchmarks/first_esp32_secure_v2.c`, and runs the actual C SDK with
mbedTLS HKDF-SHA256 and ChaCha20-Poly1305. It uses the normal 1200-byte frame maximum,
1024-counter reservation, full 16-byte tag, and both delivery modes.

The C transport callback captures the actual encrypted frames. A Node bridge
sends those exact bytes through real OS UDP sockets bound to `127.0.0.1`, calling
the production gateway's `processFrame`. The gateway uses its actual
`PostgresReplayStore` and migration 033 functions in disposable, in-memory
PostgreSQL (PGlite). Only the Supabase query transport is adapted to that local
database. The real gateway authenticates, decrypts, decodes, persists and returns
the receipt. That actual receipt is passed back into the C SDK, where `poll`
must return `STRUCT_COMMITTED`. A second, identical local C execution verifies
the receipt; it does not send a second UDP datagram or change nonce/plaintext.

This is an ESP32 **application simulation on the host**, using its real C
serializer and SDK. It is not ESP32 instruction-set or Wi-Fi/radio emulation.
NVS callbacks are simulated and fresh test credentials are provisioned locally.
No hardware speed, energy, flash durability, TLS bootstrap or Internet latency
claim follows from these results. The gateway's available JavaScript parser
fallback is used when its optional native addon is absent.

No production environment files, credentials, devices, database or configuration
are read or changed. The benchmark's public deterministic root is for isolated
tests only. Every run creates a fresh local database and destroys its temporary
C build directory afterwards. Network traffic stays on loopback.

## Measured result

Application counts below are lengths of actual datagrams received over UDP.
Network columns add the requested **estimated 28 bytes** per datagram: 20-byte
IPv4 header without options and 8-byte UDP header. They exclude Ethernet/Wi-Fi,
radio attach, retries, provisioning and fragmentation. Each case sends one
reading, without batching or retry.

| Metric | Original V1, unencrypted | Secure V2 original | Secure V2 optimized |
| --- | ---: | ---: | ---: |
| Encoded sensor payload | 9 B | 9 B | 3 B |
| Protocol header | Included in 66 B overhead | 9 B | 9 B |
| AEAD tag | No encryption | 16 B | 16 B |
| Application uplink | 75 B | 34 B | 28 B |
| Estimated UDP/IPv4 uplink | 103 B | 62 B | 56 B |
| Application receipt, confirmed | 69 B | 21 B | 21 B |
| Estimated receipt with UDP/IPv4 | 97 B | 49 B | 49 B |
| Estimated confirmed round trip | 200 B | 111 B | 105 B |
| IPv4 uplink reduction vs V1 | — | 39.81% | 45.63% |
| Application uplink reduction vs V1 | — | 54.67% | 62.67% |

Unconfirmed mode produces the same 34 B / 28 B application sizes, with no receipt:
62 B / 56 B estimated total network traffic. Confirmed mode sets the receipt flag
inside the existing control byte, so its uplink does not grow.

The original schema keeps `STRUCT_SCHEMA_VERSION 1`, its field names/types and
little-endian serializer. Secure V2 carries immutable **slot 1** in the control
byte instead of a separate schema-version byte. The slot points to legacy
schema version 1 in the local database. The optimized schema uses independent
slot 2 and explicitly changes the representation to fixed point:

- Temperature: -40..125 °C, 0.1 °C steps; 1,651 possible levels, 11 bits.
- Humidity: 0..100%, 0.1 percentage-point steps; 1,001 levels, 10 bits.
- Active: 1 bit; final two padding bits are zero. Total: 22 useful bits in 3 B.

The generated C and canonical JS encoders agree on optimized plaintext
`4F 73 2C`: temperature code 635, humidity code 613, active 1, padding 00.
Fixed point is lossy: 61.25 rounds to 61.3 (half-step upward), an absolute
humidity error of approximately 0.05 percentage points. Temperature stays 23.5.
The original schema recovers all three original values exactly. Both optimized
numeric errors are checked against half the declared step, with floating-point
tolerance. Four telemetry rows are committed, four tampered frames are rejected,
and both real gateway receipts are authenticated by the C SDK.

## Exact frames from the deterministic test run

The root is the public test-only bytes `00 01 ... 1F`; original simulated wire ID
is 1 and optimized wire ID is 2. Each namespace sends sequence 0 unconfirmed,
then sequence 1 confirmed. Changing credentials or sequences changes ciphertext
and tags, but not packet lengths. Complete frames:

```text
Original unconfirmed (34 B):
84 00 00 00 01 00 00 00 00 0E FC DF B9 C6 14 BD 38 92 4D F5 BD B2 06 77 AC E5 50 02 09 B0 C9 8E B1 89
Original confirmed (34 B):
86 00 00 00 01 00 00 00 01 58 81 68 78 58 DB CF E7 B1 22 D5 FF 25 C3 24 D6 38 72 A5 11 A2 AC C2 D1 FE
Original confirmed receipt (21 B):
C0 00 00 00 01 35 16 40 95 86 89 EB 15 AA D6 4B D7 D4 5D E1 77

Optimized unconfirmed (28 B):
88 00 00 00 02 00 00 00 00 54 74 E1 FF D7 B1 01 90 ED ED 7B 01 4E F4 D3 63 68 39 87
Optimized confirmed (28 B):
8A 00 00 00 02 00 00 00 01 2A AA BF D6 72 F4 3D 04 B3 0B 27 70 A2 60 80 32 C0 D2 99
Optimized confirmed receipt (21 B):
C0 00 00 00 01 25 2D CF 8A EE 39 33 BC A3 7F 7A 4F DF 2C 69 3E
```

Uplink byte offsets (zero-based):

| Bytes | Original | Optimized |
| --- | --- | --- |
| 0 | Control | Control |
| 1..4 | Wire ID, BE32 | Wire ID, BE32 |
| 5..8 | Sequence, BE32 | Sequence, BE32 |
| 9..17 / 9..11 | 9 B ciphertext | 3 B ciphertext |
| 18..33 / 12..27 | 16 B authentication tag | 16 B authentication tag |

Control is `[generation:2][slot:4][confirmed:1][batch:1]`: generation `10`,
slot `0001` or `0010`, confirmed 0/1, batch 0. Thus 84/86 for original and 88/8A
for optimized. All nine header bytes are authenticated as AAD.

The plaintext's bytes 0..3 encode temperature, 4..7 humidity, and byte 8 active.
Optimized bit offsets are 0..10 temperature, 11..20 humidity, 21 active and
22..23 zero padding, all MSB first. Receipt byte 0 is C0, 1..4 sequence BE32,
and 5..20 the 16-byte tag over its five-byte header and empty ciphertext.

The 12-byte nonce is derived from the eight-byte HKDF prefix and sequence;
it is not transmitted. Encryption preserves payload length. There is no cipher
padding or extra HMAC. Measured fixed overhead is **9 + 16 = exactly 25 B**.

## Reproduce

Use Node 24.18+ (native TS type stripping and synchronous module-resolution
hooks), root dependencies (`npm ci`), and gateway dependencies
(`npm --prefix tcp-server ci`). Install a C compiler and mbedTLS development
library, or use the Windows/WASI alternative below. This does not need a web
server, physical board, cloud connection, production keys or PlatformIO.

```text
npm run benchmark:secure-v2:esp32
npm run benchmark:secure-v2:esp32 -- --output work/secure-v2-first-esp32-benchmark.json
```

The optional JSON output parent directory must already exist. It contains actual
frame/payload/receipt hex, all four cases, decoded values and errors, the real
generated C headers, source SHA256 hashes, runtime/compiler details and baseline.
The accompanying [recorded run](benchmarks/secure-v2-first-esp32.json) was produced
by the script; timestamps can differ on subsequent runs while packet bytes remain
deterministic. Source hashes identify the exact implementation measured.

On Windows, use an existing Zig compiler and unpacked upstream mbedTLS 3.6.7:

```powershell
$env:STRUCT_ZIG_COMPILER = 'C:\path\to\zig.exe'
$env:STRUCT_MBEDTLS_SOURCE = 'C:\path\to\mbedtls-3.6.7'
npm run benchmark:secure-v2:esp32
```

That compiles and runs the real C/mbedTLS SDK as WASI. It does not substitute
Node cryptography for firmware cryptography. Alternatively set
`STRUCT_C_COMPILER` for a native host compiler. The benchmark fails if the
compiler/crypto dependency is unavailable; it never substitutes estimated sizes.
