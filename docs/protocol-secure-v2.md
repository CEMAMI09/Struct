# Struct Secure V2

Status: implemented release candidate, disabled by default pending deployment and hardware qualification. Secure V2 is additive to deployed legacy wire protocols 2, 3 and 4; the legacy name “Protocol v2” is not this protocol. UDP port 8081 is the initial V2 transport. Legacy TCP 8080 remains unchanged; V2 is not accepted over its unframed stream. A future V2 TCP transport must specify framing separately.

## Architecture and implementation plan

The existing gateway shares ingestion through `tcp-server/ingest.js`; UDP validates framing before that call. Node SDK framing lives in `sdk/js`, portable C callbacks in `sdk/c/src`, and ESP32 adapters in `sdk/c/integrations`. PostgreSQL telemetry triggers enqueue the existing durable webhook outbox. Schema publishing is already versioned and immutable. Credentials use the existing AES-256-GCM `v1:iv:ciphertext:tag` envelope at rest. Browser SELECT privileges expose explicit public columns.

Implementation order: freeze this specification; generate independent Node/C golden vectors; add bounded framing, authentication and protocol dispatch; add atomic replay/batch storage migrations; implement additive portable SDK and ESP32 persistence; add explicit packed schema compiler and immutable slot publication; generate complete PlatformIO projects; update debug tools, ingress filters and traces; run regression, database, cross-language and real ESP32-C3 build tests. Never replace the legacy byte encoder or globally upgrade devices.

## Wire format and limits

```text
UDP uplink:
offset  size  meaning
0       1     control
1       4     wire_device_id, unsigned big endian
5       4     sequence, unsigned big endian
9       N     ciphertext
9+N     16    full Poly1305 authentication tag
```

Fixed overhead is exactly 25 bytes. Header integers are network byte order. No timestamp, random nonce, UUID, key ID string or additional HMAC is transmitted. One datagram is one envelope. Default maximum application datagram is 1200 bytes, configurable only within 25..1400; schema records and batches must fit. Reject an oversized datagram before allocation/decryption. Normal single-record payload length must equal its assigned schema length exactly.

Control bits: 7..6 = binary `10` (Secure V2 uplink); 5..2 = immutable schema slot 0..15; bit 1 = receipt requested; bit 0 = batch. Valid uplink controls are 0x80..0xBF. These cannot collide with legacy 0x02/0x03/0x04. Other generations/controls are rejected. Named constants/helpers own masks in each language. Header control, identifier and sequence are authenticated as the exact 9 AAD bytes.

## Credentials and rotation

Each Secure V2 credential has a cryptographically random 32-byte root secret, an allocated unique uint32 wire ID, and a server-side generation record. IDs are centrally allocated with a unique constraint and never recycled. The stable dashboard device UUID remains unchanged. An explicit enrollment adds V2 alongside its existing legacy credentials. A V2 rotation allocates BOTH a new root and a new wire ID; no extra key identifier is needed in packets. A previous credential may remain valid for a bounded grace interval (maximum 24 hours, default zero); each wire ID has separate replay/counter state. The database checks credential validity again inside the storage transaction, closing a revocation race. Old schema slots remain immutable and shared by the stable device.

Roots and one-time provisioning tokens are encrypted with the existing credential-at-rest envelope. Normal device selects, traces, audit data and API serializers never expose roots, tokens, derived keys or nonce prefixes. Secret export/enrollment/rotation is a writer-authorized, explicit, non-cacheable action. A compromised root authenticates that device; the wire ID is public and provides no security.

## Key and nonce derivation

Use standard HKDF-SHA256 (RFC 5869) and IETF ChaCha20-Poly1305 (RFC 8439). Root input is the decoded 32 bytes, not its 64-character hex representation. HKDF salt is UTF-8/ASCII `struct-secure-v2/hkdf-sha256`. For each output, info is:

```text
ASCII label || 0x00 || 0x02 || uint32_be(wire_device_id)
```

Outputs: `struct-v2/uplink/key` -> 32 bytes; `struct-v2/downlink/key` -> 32 bytes; `struct-v2/uplink/nonce` -> 8 bytes; `struct-v2/downlink/nonce` -> 8 bytes. These four domains are independent. The uplink nonce is uplink prefix || uint32_be(sequence); downlink nonce uses its downlink prefix. The sequence range is 0..4294967295. Exhaustion is terminal and requires a new credential, never wraparound.

AEAD plaintext is the encoded record or batch. AAD is the exact header. Release plaintext only after verification succeeds. Header changes, wrong roots, changed ciphertext or tag all fail authentication. Return no unauthenticated UDP error response and expose only a generic authentication failure in privileged traces. Only after authentication may rate limits keyed by credential, slot resolution, decoding or replay mutation run.

## Device counter reservation and first provisioning

Portable SDK uses an atomic durable range-reservation callback, default block 1024. Persistent state binds to the exact wire ID/root keyspace and stores a uint64 exclusive next-unreserved bound, allowing the exhaustion sentinel 4294967296. Persist/commit the new bound BEFORE returning a usable RAM range. Never return sequences after a write/commit error. On reboot skip every previously reserved value. The SDK retains the exact encrypted frame for retries; never re-encrypt changed plaintext/header with a previous sequence.

Ordinary reservation must fail closed on missing, corrupt or mismatched state. A fresh ESP32 starter initializes missing NVS through a ONE-TIME server provisioning token issued with the new credential. HTTPS consumes that token atomically and returns the initial counter (`nextSequence:0`) only before any packet was accepted; the adapter commits NVS and then reserves a range before sending. Tokens cannot be reused after an erase. If power fails after token consumption but before the durable write, rotate the credential rather than infer an unused range. Tokens are independent random credentials and never send the root secret to the server. TLS server authentication is mandatory; no insecure TLS fallback. A portable integration may instead explicitly provision fresh durable state during trusted manufacturing, before the root is ever used. Rollback of a previously valid persistent record cannot be detected by this offline SDK alone and remains an explicit hardware/application assumption.

Factory erase/reset preserving firmware/root must NOT automatically recreate counter zero. After counter state loss, token reuse fails; enroll a fresh root/wire ID. Restoring an old flash backup, cloning firmware with its root, NVS rollback, or two clients using the same credential violates this model and requires hardware/application controls. Sequence state is a security asset, not an optional cache. ESP32 NVS must have one owner and commit reservation atomically. Credential rotations never silently reset a surviving old keyspace.

## Replay, identity and atomic storage

The ReplayStore boundary accepts only authenticated and validated frames. Current implementation uses a service-only PostgreSQL RPC per wire ID, serialized by a row lock. Maintain highest sequence and a durable 64-bit window. For a new highest, shift the bitmap by the positive difference (clear it for difference >=64), set the current bit and advance highest. An unseen sequence with highest-sequence <64 is accepted once. A seen sequence is duplicate only if its stored SHA-256 frame digest matches exactly. A changed authenticated frame for the same sequence is a nonce/identity conflict and receives no success receipt. A sequence outside the window is stale, even if once accepted.

Commit window update, persistent packet identity/digest, all telemetry rows, presence and existing outbox trigger effects in one transaction. Storage failure rolls all of them back. A unique `(wire_device_id, sequence)` packet ledger is a second guard. A batch row identity adds a record index; the envelope sequence identifies the batch. Rotation creates a new wire ID/keyspace, so sequence zero cannot collide with historical events. Keep replay high water across restarts and telemetry retention; do not expire it with telemetry. Exact duplicate retry never inserts, counts or routes again. It returns the existing logical success receipt when requested. Multiple gateways use the same atomic authority, not process-local replay state.

## Receipts and delivery

```text
[receipt_control=0xC0:1][sequence:uint32_be:4][tag:16]
```

Exactly 21 application bytes. AAD is the first 5 bytes. Plaintext is empty; downlink key and prefix provide an independent domain. The receipt is identical for first commit and every exact duplicate. There are no mutable success/duplicate/error bits. Never use this nonce for a different downlink message. Rich errors/commands need another protocol/domain; this release sends no V2 error/control messages.

A verified receipt means the entire envelope's telemetry committed, not webhook delivery. Unconfirmed sends once and requests no receipt. Confirmed uses the existing bounded delivery/retry policy, resending the identical frame and accepting only a valid receipt for its pending sequence/keyspace. Polling/receipt reception must be nonblocking. A missing receipt is `unknown`, not proof of loss. Unconfirmed has no server acceptance proof.

## Schema slots and payload encodings

Slots 0..15 are explicitly published, immutable per device, and never silently reassigned or deleted/reused. Slot metadata stores encoding, schema definition, optional historical schema version and optional sample interval. Unknown slots fail after AEAD succeeds, with no replay mutation. Editing a schema publishes into an unused slot; old firmware remains decodable. Sixteen-slot exhaustion requires an explicit new device/configuration migration rather than guessing deployed firmware is gone.

`legacy-le-v1` preserves current explicit byte encoders/decoders exactly: float32/int32 little endian, uint8/boolean/flags one byte, fixed char bytes. The float32+float32+boolean example is 9 bytes and a 34-byte V2 frame (62 bytes with IPv4/UDP).

`bitpacked-v1` is explicit and never changes a saved legacy schema. Field order is definition order. Within bytes, bit 7 is written first; each numeric code is most significant bit first, without byte alignment. Signed integers use two's complement at declared width. Low unused bits of the final byte must be zero; decoders reject nonzero padding. No native C struct layout/ABI is used.

Supported fields: boolean (1 bit); uint and int (explicit width 1..32, optionally constrained range); enum (ordered, distinct string values, ceil(log2(count)), minimum 1 bit); bitset (width 1..32); fixed (finite min/max/positive precision, optional explicit clamp); float16 and float32 (IEEE 754 raw bits, MSB first, round-to-nearest ties-to-even for float16). NaN/infinity are rejected. Integers and enums reject unused/out-of-range codes. Floats retain declared semantics, without implicit conversion to fixed point.

For fixed point, calculate levels=floor((max-min)/precision)+1, snapping a quotient within `1e-7` quantization steps of an integer to that integer; require levels>=2 and <=2^32. Width=ceil(log2(levels)). Values outside [min,max] fail unless clamp explicitly true. Code=floor((value-min)/precision+0.5), snapping within `1e-7` steps of a half tie before rounding, i.e. ties toward the larger nonnegative code. Require code<levels. Decode min+code*precision; unused codes fail. Schema validation and generated C must use the same numerical limits/tolerance. Definitions must be bounded (at most 128 fields) and payloads fit the maximum envelope. Exact codec rules/vectors are normative together.

Environmental fixed temperature -40..125 step0.1 uses 11 bits; humidity0..100 step0.1 uses10 bits; active uses1:22 bits ->3 bytes, a28-byte frame and56 bytes including IPv4/UDP. This precision reduction is explicit schema configuration, not lossless compression of arbitrary float32 values.

## Batch format

With batch flag set, decrypted plaintext is `[count:uint8][count fixed-size encoded records]`. Count1..255; record size comes from the immutable slot. Exact length must be 1+count*recordSize. No per-record security tag or repeated length. SDK splits before its configured maximum datagram. One fresh sequence per envelope, not per record. Optional sample interval is slot configuration; absent it, timestamps are server acceptance time. This version adds no timestamp metadata to packets. Applications needing source timestamps may declare them as schema fields; future compact timestamp modes require a new encoding/slot and specification.

## Dispatch, diagnostics and rollout

Ingress prefilters accept legacy minimum66/versions2..4 OR Secure V2 minimum25/top bits10. TCP remains legacy. Global `STRUCT_SECURE_V2_ENABLED` and explicit per-device enrollment govern rollout; no legacy credential is revoked by enrollment. Default client SDK endpoint is `ingest.usestruct.com:8081`, overridable for development/private deployments; generated production code never uses a raw hosting IP. Pin SDK/protocol versions in generated projects.

Debug sender must choose explicit V2 mode and use persistent sequence reservation or test-only golden-vector sequences; never silently default to sequence zero. Traces show protocol, cipher, AEAD result, slot, sequence, replay/duplicate state, batch count, payload bytes, fixed envelope bytes, full datagram bytes, IPv4/UDP estimate and requested/generated receipt. Never include secrets or prefixes. Preserve existing diagnostic imports and legacy trace meanings.

## Validation and external review

Canonical fixtures use TEST-ONLY roots and cover normal9-byte payload, sequence0/max, crypto-level empty plaintext, packed3-byte example, batch and confirmed receipts. C and Node must independently reproduce derived keys, prefixes, nonces, AAD, ciphertext and tags. Empty plaintext is permitted by the crypto primitive for vectors/receipts, but telemetry schemas must contain at least one nonempty field. Tests must cover every header/payload/tag mutation, truncation, length extension, invalid generations/slots, wrong secrets, malformed counts/padding, out-of-order delivery, duplicates, stale replay, transactional rollback, concurrent gateways, key rotation, reboots, failed persistence and factory erase. Real ESP32-C3 PlatformIO build is a release gate. Physical device flash/power-loss tests, production gateway rollout, external protocol/crypto review, secure provisioning/TLS assumptions and durable-storage rollback resistance remain separately verifiable operational gates.

References: [HKDF RFC5869](https://www.rfc-editor.org/rfc/rfc5869), [ChaCha20-Poly1305 RFC8439](https://www.rfc-editor.org/rfc/rfc8439).
