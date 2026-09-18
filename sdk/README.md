# Struct device SDK (preview)

The new [dependable delivery guide](../docs/DEPENDABLE-DELIVERY.md) covers C/Node
persistent queues (v4), the ESP32 NVS adapter, authenticated command helpers and
durable telemetry webhooks. Hardware qualification is still outstanding.

The SDK takes packed payload bytes, constructs the authenticated frame, manages
the UDP socket, verifies storage receipts, and bounds retries. No API secret is
sent over the network. Use it with the updated gateway and migration 020.

## What's included

- **C / C++:** C99 core with a caller-owned fixed frame buffer, nonblocking polling,
  mbedTLS HMAC and optional ChaCha20-Poly1305, and a POSIX socket adapter.
- **Arduino:** ESP32 `StructEsp32` adapter and a working integration sketch under
  `c/examples/Telemetry`. Other Arduino boards need a transport/crypto adapter.
- **JavaScript:** Node.js UDP client, signing, optional encryption and retries.
  Browser JavaScript can generate payloads but cannot open a UDP socket.
- **Python:** standard-library UDP client, signing and retries. This initial client
  does **not** implement ChaCha20 encryption; do not use it for an encrypted device.
- **Rust:** the web app exports dependency-free payload encoders. A Rust transport
  and crypto SDK is **not included** in this release.

All six encoder targets are available in Schema and the public schema sandbox.
The dashboard only downloads saved schemas. Encoders explicitly write little-endian
bytes; never send `sizeof(native_struct)` bytes and assume its layout matches.
`char[N]` takes exactly N raw bytes. C/Rust members use `f_` prefixes so language
keywords in schema names don't break compilation. Flags use masks in C/Rust and
named booleans in JavaScript/Python. Secrets are deliberately absent from downloads.

## Delivery and battery budget

There are two explicit modes:

1. **Send once (default):** Protocol 2, one datagram, no receipt or retry. `sent`
   means the local socket accepted it. It does not mean the database received it.
2. **Confirmed:** Protocol 3, same authenticated layout, with a signed UDP receipt
   after the database transaction commits. `committed` means telemetry was stored.
   Exact retransmissions produce another receipt without inserting another row.

The default confirmed budget is **7,500 ms**, **one retry**, and **3,000 ms initial
retry delay plus 0–25% jitter**. Further retries (at most three) back off
exponentially. Set `maxRetries=0` (Node) or `max_retries=0` (C/Python) to listen once
without retransmitting. Set a shorter total budget when the radio must sleep sooner.
If the budget ends, delivery is **unknown**, not failed: either the packet or its
receipt may have been lost. There is no automatic downgrade to unconfirmed mode.

The C budget covers time from `struct_send` through polling, assuming nonblocking
callbacks. Node includes socket/DNS setup in its deadline. Python accepts a numeric
IPv4 address to avoid an unbounded DNS lookup. Board wake-up, network registration,
DNS during adapter setup, time synchronization, and modem radio-tail time are
outside the C/Python send budget. The SDK does not claim measured battery savings.

Send-once samples are suitable when the next reading supersedes the previous one.
Use confirmed sends selectively for important events. The caller owns pacing
between **new** samples and any persistent offline queue. Do not restart a timed-out
send in a tight loop: a new call creates a new nonce and can store a second sample.
Default replay skew is 60 seconds; retry the identical frame within that window.
This is not an indefinite store-and-forward protocol or exactly-once webhook delivery.
For sustained high-volume or always-connected traffic, use a congestion-controlled
transport. The backoff follows the low-volume principles in
[RFC 8085](https://www.rfc-editor.org/rfc/rfc8085.html).

## ESP32 Arduino

Copy `c/` into your Arduino libraries folder as `Struct`, or make a ZIP of that
folder and use Arduino's Add ZIP Library. Open **Struct → Telemetry**. Configure
WiFi, gateway IP, `KEY_ID` and the API secret shown at device creation/rotation.
Configure clock synchronization before sending. Never use the public key ID as
the HMAC secret.

With a downloaded `struct_packet_v1.h`:

```cpp
#include <StructEsp32.h>
#include "struct_packet_v1.h"

StructEsp32 telemetry;
// After WiFi + clock sync:
// telemetry.begin(IPAddress(192,168,1,100), 8081, KEY_ID, API_SECRET);

// For schema temperature=float32, battery=uint8:
StructPacket packet{};
packet.f_temperature = 23.5f;
packet.f_battery = 91;
uint8_t payload[STRUCT_PACKET_SIZE];
struct_pack_packet(payload, sizeof(payload), &packet);
auto status = telemetry.send(STRUCT_SCHEMA_VERSION, payload, sizeof(payload),
                             struct_delivery_default(1));
// In loop(): status = telemetry.poll();
// STRUCT_PENDING: keep polling cooperatively.
// STRUCT_COMMITTED: database confirmed storage.
// STRUCT_UNKNOWN: stop waiting; delivery is uncertain.
// STRUCT_SENT: unconfirmed local send succeeded.
// Negative values report invalid configuration, I/O, or crypto failures.
```

Call `telemetry.end()` before closing a radio session; it closes the socket and
wipes buffered credentials. For encryption, decode the separate dashboard
encryption key into 32 bytes and call `telemetry.encryption(key)` before sending.
The board build must enable mbedTLS ChaCha20-Poly1305; absent support fails closed.
ESP32 uses `esp_fill_random` with WiFi active. No home-grown crypto is bundled.

## Portable C and POSIX

Compile `c/src/struct_sdk.c` and include `c/src`. `struct_init` accepts the public
16-character ID, literal 64-character API secret, and `struct_port` callbacks.
The SDK copies the credentials. Provide a secure RNG and HMAC callback; socket
callbacks must send/receive a complete nonblocking datagram, not a TCP stream.
Use a connected UDP socket or validate the remote address/port yourself.
`struct_send` owns one in-flight frame; concurrent sends return `STRUCT_BUSY`.
`struct_poll(client, monotonic_ms)` handles timer wrap and checks at most one
received datagram per call. Do not call it from multiple threads concurrently.

For Linux/POSIX, compile `c/ports/struct_posix.c`, include `c/ports`, and link
`mbedcrypto`. `struct_posix_open(&adapter, &port, host, "8081")` supplies the
callbacks, socket and cryptographic RNG. Setup is outside the send budget.
Call `struct_posix_close` and `struct_clear` when finished.

The core uses a 1,400-byte frame buffer inside `struct_client` and a bounded
temporary plaintext buffer on the stack. The core and generated packing functions
use no heap; mbedTLS, networking stacks and adapters can allocate memory.

## Node.js

Install locally with `npm install /path/to/sdk/js`, or require its `index.cjs`.

```js
const { StructClient } = require('./sdk/js')
const device = new StructClient({
  host: '127.0.0.1', port: 8081,
  keyId: process.env.KEY_ID, apiSecret: process.env.API_SECRET,
  // encryptionKey: process.env.ENCRYPTION_KEY,
})
const payload = Buffer.alloc(4)
payload.writeFloatLE(23.5)
const result = await device.send(1, payload, {
  confirmed: true, maxRetries: 1, retryMs: 3000, budgetMs: 7500,
})
console.log(result.status) // committed | unknown | sent
```

For generated `.mjs` encoders, import `pack` and pass `Buffer.from(pack(values))`.
One client permits one send at a time. The socket closes on success, timeout or error.

## Python

Place `python/struct_device.py` on your module path. No pip dependencies:

```python
import os, struct
from struct_device import StructClient
device = StructClient('127.0.0.1', os.environ['KEY_ID'], os.environ['API_SECRET'])
result = device.send(1, struct.pack('<f', 23.5), confirmed=True,
                     max_retries=1, retry_ms=3000, budget_ms=7500)
print(result['status'])
```

This synchronous call waits only up to the configured budget. Use an application
worker thread if your program has other work to perform meanwhile.

## Wire contract

See the complete [delivery contract](../docs/CONTRACT.md),
[wire specification](../docs/PROTOCOL.md), and [release gates](../docs/RELEASE-GATES.md).
In the downloadable SDK ZIP, these documents are bundled under `docs/` at the
archive root. Frozen fixtures are in `tests/protocol-vectors.json`.

Unencrypted telemetry (N payload bytes):

```text
[protocol:1][key_id ASCII:16][schema:1][unix seconds LE:4][nonce:12][payload:N][HMAC:32]
```

Protocol `2` is unconfirmed TCP/UDP. Protocol `3` is confirmed **UDP telemetry
only**; schema zero remains reserved for existing v2 command acknowledgments.
Old gateways reject v3. Upgrade first; do not silently downgrade.

HMAC-SHA256 uses the literal ASCII API secret over every preceding frame byte.
Frame overhead is 66 bytes. Optional encryption replaces the payload region with
`[separate nonce:12][ciphertext of timestamp LE:4 + payload:N][tag:16]`, adding
32 bytes. C and Node match this existing encrypted gateway format.

Storage receipt, exactly 69 bytes:

```text
[ASCII "STRA":4][original telemetry HMAC:32][status:1][receipt HMAC:32]
```

Status `0` = newly stored, `1` = identical frame already stored. Receipt HMAC signs
the preceding 37 bytes with the same credential. The magic distinguishes receipts
from uplinks; the original frame MAC binds the receipt to the exact packet. Verify
both MACs/binding before reporting committed. No receipt is sent for rejected
authentication, schema, timestamp, rate limit or storage failures.

Maximum frame length is 1,400 bytes, including auth/encryption overhead. Payloads
are limited to 1,334 plaintext bytes or 1,302 encrypted bytes. Fleet credentials
currently use schema version 1. Rotate shared fleet credentials carefully: every
unit holding that secret has fleet-wide impersonation capability.

## Deployment and remaining scope

Apply migrations **020 and 021 before deploying** the new gateway/web app. Drain
old gateways before enabling confirmed sends: old processes reserve replay nonces
without a committed-frame digest. Keep v2 traffic during the transition, wait out
the configured replay window, then enable v3 devices. Refresh already-open schema
editors after the web rollout, because direct schema table writes are now revoked.

For dependable delivery, also apply migrations **022–024** and follow the upgrade
sequence in the dependable delivery guide. Receipts confirm storage and transactional
webhook enqueue, not remote webhook success. C/Node command helpers authenticate
STRC envelopes and journal outcomes; applications still supply command socket
integration and C durable journal callbacks. C/Node persistent telemetry queues use
v4 stable event IDs. Python remains a v2/v3 client. There is no selective/batch ACK
scheme, modem driver, or measured cellular power profile.
The ESP32 adapter requires on-board validation before production use.

The C core was exercised with real mbedTLS crypto and cross-checked against Node,
including encryption, forged receipts, retries, limits, and timer wrap. Local
Node/Python socket tests simulate lost receipts. POSIX adapter compilation and
generated encoder checks are part of the development workflow. Test your radio's
latency/loss distribution before choosing the wake budget.
