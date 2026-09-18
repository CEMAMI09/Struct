# Struct wire specification — v2/v3 preview

New protocol 4 persistent events and STRC authenticated commands are specified
in [Dependable delivery](DEPENDABLE-DELIVERY.md). The legacy unsigned downlink
below is retained as a historical reference and is no longer emitted.

All offsets are zero-based bytes. Integers use little endian. No native compiler
padding is transmitted. Normative delivery meaning is in [CONTRACT.md](CONTRACT.md).

## Telemetry

The body consists of: protocol at offset 0 (1 byte); key ID at offset 1 (16 ASCII
bytes); schema version at offset 17 (1 byte, 1..255); Unix seconds at offset 18
(uint32); replay nonce at offset 22 (12 bytes); payload region at offset 34.
The final 32 bytes are HMAC-SHA256 over the entire preceding body.

Protocol 2 means unconfirmed TCP/UDP; 3 requests a storage receipt over UDP.
The issued key ID is 16 hex characters; the legacy wire parser accepts 16 visible
ASCII characters. Use issued identifiers. The API secret is 64 ASCII hex
characters: HMAC uses these literal bytes, NOT their hex-decoded representation.
Secrets and test credentials are case-sensitive.

Each UDP datagram contains exactly one frame. TCP has no telemetry length prefix:
the receiver resolves length from the header's device/schema and encryption mode.
Frames may be split or coalesced by TCP. Trailing payload bytes are invalid.

The supported SDK frame ceiling is 1400 bytes. Plaintext overhead is 66 bytes,
allowing 1334 payload bytes. Gateway deployments may configure a different limit;
that does not extend the interoperable SDK contract or guarantee no IP fragmentation.

## Payload encoding

Fields appear in schema order: float32 is IEEE-754 binary32 LE (4 bytes), int32 is
signed two's complement LE (4), uint8 is unsigned (1), boolean is encoded 0 or 1
(1), flags occupy named positions 0..7 in one byte, char[N] is N raw bytes.
Canonical encoders must emit boolean 0/1; legacy decoders treat any nonzero as true.
Use finite floats for interoperable JSON. char arrays are bytes, not UTF-8 strings;
legacy display decoding is not a lossless representation of every binary array.
The schema is required for decoding; the packet contains no field names or tags.

## Optional encryption

Replace the payload region with a separate 12-byte encryption nonce, ciphertext,
and 16-byte authentication tag. ChaCha20-Poly1305 encrypts uint32 LE timestamp
followed by the packed payload. There is no additional authenticated data; outer
HMAC authenticates the complete envelope. The encryption key is hex-decoded to
32 bytes, unlike the HMAC secret. This adds 32 bytes of overhead (98 total),
allowing 1302 payload bytes. Header timestamp remains visible. The current gateway
validates both timestamps for freshness; it does not require their equality.
Canonical SDKs write the same timestamp in both places.

## Storage receipt

Exactly 69 bytes: ASCII STRA at offset 0 (4); original uplink HMAC at offset 4
(32); status at offset 36 (0=new commit, 1=identical duplicate); receipt HMAC at
offset 37 (32). Sign bytes 0..36 using the same literal API secret.
Clients verify size, magic, status, exact frame binding and HMAC before accepting.
Receipts contain no payload and do not acknowledge downstream webhook delivery.

## Legacy commands

Schema-zero v2 uplink: protocol (1), key ID (16), zero (1), command UUID raw bytes
(16), result code (1), HMAC (32): 67 bytes. It has no timestamp/nonce; command
lifecycle checks provide its context. Legacy downlink: uint16 LE inner length,
protocol byte 2, UUID (16), command payload. This downlink envelope is unsigned.
This old downlink is documented only for historical recognition and is no longer
sent by the gateway. Use STRC from the dependable delivery specification. The
schema-zero uplink remains 67 bytes; result codes 16–20 report authenticated-command
outcomes. Legacy result code 0 is not accepted as evidence of execution.

## Conformance

Fixed public test credentials and vectors are in
[protocol-vectors.json](../sdk/tests/protocol-vectors.json). They must never be
used on deployed devices. Tests compare frozen bytes with the implementation,
independently verify HMAC, decrypt encrypted fixtures and reject forged receipts.
Changes require explicit compatibility review; never regenerate expected fixtures
merely to make a failing test pass.
