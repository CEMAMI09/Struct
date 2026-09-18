# Dependable delivery foundation — implementation preview

This document supersedes the unsupported-feature notes in contract revision 1
for telemetry webhooks, authenticated commands and persistent C/Node queues.
Physical hardware qualification and production deployment are still separate.

## Deployment

Apply migrations 022, 023 and 024 after 020/021, then deploy the gateway and web
app. Migration 022 attaches delivery jobs to every new telemetry insert in the
same transaction. Migration 023 changes command permissions and status semantics.
Migration 024 adds permanent per-device event IDs for queued transmissions.
Do not roll back to an old gateway that still directly dispatches telemetry
webhooks: it would send an extra copy in addition to the outbox. Replace gateways
together or disable old direct fan-out before starting the worker.

The main gateway starts its outbox worker automatically. The new dashboard route
`/dashboard/deliveries` shows the latest 100 jobs and per-job history, and allows
organization writers to replay dead jobs up to three times. Deploy these
migrations on staging and rehearse upgrade/rollback before production.

## Webhook commit boundary

Every eligible destination gets a job with the telemetry UUID as stable `body.id`
and `x-struct-event-id`. The destination URL, routing rule and event body are
snapshotted during telemetry commit. Secrets are read from the destination when
sending, allowing secret rotation. Deleting/disabling a destination or changing
its URL stops its pending jobs instead of redirecting historical data elsewhere.
Routing rules are evaluated before HTTP; a nonmatch is recorded as skipped.

The worker claims up to eight jobs, sends concurrently with an eight-second
request deadline, then records outcomes using a unique lease token. Expired leases
are reclaimed. Completion by an old worker cannot overwrite a newer lease.
Failures retry with exponential backoff/jitter (up to one hour between attempts),
and become dead after eight attempts. Explicit replay preserves event identity,
resets the attempt budget and adds an audit entry. Delivery history persists
until the organization/history is intentionally deleted; plan its retention.

Delivery is at least once with bounded attempts, not exactly once. A process
can die after the receiver commits and before Struct records HTTP success.
Receivers must transactionally deduplicate `body.id` with their side effect.
Only HTTP 2xx marks delivery complete. A receipt to the device confirms telemetry
and durable enqueue, not eventual receiver acceptance. An unavailable outbox
causes telemetry rollback and no successful receipt. Existing connection and
disconnection webhooks are still best effort; this outbox covers telemetry.

## Authenticated commands

TCP command wire format: uint16 LE length, then the signed inner envelope:
`STRA` is reserved for receipts; commands use `STRC` (4), key ID ASCII (16),
command UUID bytes (16), issued Unix seconds LE (4), expiry LE (4), command payload
(1..1324), and HMAC-SHA256 (32) over the inner envelope before the HMAC.
The HMAC key is the literal API secret. Maximum inner size is 1400 bytes.
Commands are authenticated but not encrypted; use a confidential transport for
sensitive commands. The old unsigned envelope is no longer emitted. Old firmware
must be upgraded; there is no silent fallback to unsigned commands.

Command ACKs retain the signed v2 schema-zero framing. Result codes are now
16 received, 17 executed, 18 rejected, 19 expired, 20 unknown. Legacy code zero
is not treated as executed. Terminal statuses cannot be downgraded by replaying
a received ACK. Late ACKs past command expiry do not establish execution status.
Unsent expired commands are expired; previously attempted ones become unknown.
Commands retry up to eight times while unexpired and are checked when devices
connect/send telemetry or a realtime command notification arrives.

`sdk/js/command-receiver.cjs` supplies a durable bounded command journal.
`struct_commands.h` supplies verification, status ACKs and an execution wrapper;
C platforms provide durable journal load/save and the hardware-specific action.
Never evict a live command ID. A full journal rejects work. Save received before
executing and save the result before reporting it. After reset, a received-only
record produces unknown and is never blindly executed again. This avoids
automatic double execution but cannot guarantee every action executes: hardware
effects and flash commits are not one transaction. For retryable operations,
make the application handler idempotent using command ID (e.g. set a target
value rather than increment it). Retain journal IDs until command expiry.
TCP framing/socket integration remains platform-specific; the ESP32 UDP telemetry
adapter does not receive TCP commands. Do not call that an out-of-box control SDK.

## Persistent telemetry: protocol 4

UDP-only, per-device credentials. Header and receipt are unchanged from v3 except
the protocol byte is 4. Before optional encryption, prepend a stable 16-byte event
ID to the payload. Its ID and schema/payload digest are stored transactionally.
New transmissions may have a fresh timestamp, nonce and encryption nonce while
retaining the same event ID. Same ID with changed schema or bytes is rejected.
Matching events do not create another telemetry row or outbox job. Keep event IDs
for the device lifetime, independent of telemetry retention; deleting them would
allow old events to reappear. Account for this index's storage growth.

C/Node queue APIs cap payloads at 1286 bytes so encrypted v4 frames fit 1400 bytes.
Original observation time belongs in the application schema; outer timestamps
are transmission time. Clock sync is still required after reset. There is no
ordering guarantee across devices or gateways.

Node: `PersistentQueue(file,{keyId,capacity:32})`; `enqueue(version,payload)`
durably saves before returning. `flushOne(client)` sends one reading and removes
it only after verified storage confirmation. Unknown/I/O errors retain it.
Expired records block the head until explicit `discard(id)`. Capacity is 1..256;
full rejects the new reading. Default local TTL is one day, configurable to
30 days. TTL is a client queue policy, not server-enforced data expiry.

The queue uses a checksummed snapshot, synced temporary file and atomic rename.
Only one writer owns the file. After a dead process leaves a lock, explicit
`recover:true` checks the recorded PID is no longer alive before acquiring it.
Corrupt files or changed key ID fail closed. POSIX directory fsync is used;
Windows power-loss durability depends on the filesystem. Do not claim equivalent
physical power-loss guarantees without testing the target storage.

C: `struct_queue_open/enqueue/step` uses two independent snapshots with generation
and CRC, four records maximum, no heap allocations. `StructNvsQueue.h` adapts this
to ESP32 Preferences. Open and enqueue before sending; call step cooperatively.
Expired/full returns an explicit error without silent eviction. Use a separate
client for queue draining; never mix direct sends/poll calls while it is active.
After unknown or reconnect, the application chooses a backoff before restarting
step. A completed receipt removes one record through another durable commit.
If that commit fails, retrying the saved event is safe because the server
deduplicates its stable ID. After storage errors, reopen/inspect the queue before
enqueueing the same sample again; a failed write can have an uncertain outcome.

Queue identity is pinned to key ID. Rotating only the secret permits re-signing
queued events after reopening with current credentials. If rotation changes key
ID, draining fails closed; explicit migration must preserve the same server device
and event IDs. No automatic discard or cross-device reassignment is performed.

## Flash wear and confidentiality

A C snapshot is 5276 bytes; two slots require at least 10552 data bytes plus
filesystem/NVS metadata and garbage-collection headroom. An enqueue and successful
dequeue each write a snapshot: about 10.6 KB logical writes per delivered reading,
before flash write amplification. This initial design favors crash clarity over
write endurance. It is unsuitable for high-rate sampling without larger wear-
leveled storage, batching or a reviewed append journal. Queue functions use about
5.3 KB scratch stack; reserve adequate task stack plus crypto/network overhead
(start with at least 16 KB and measure high-water marks on the target).

Queue payloads are stored locally in plaintext, even when transport encryption is
enabled. Protect the filesystem/NVS partition with platform storage encryption and
access controls. CRC detects torn writes, not hostile modification. Test actual
flash power cuts, wear leveling and space exhaustion before production use.

## Validation

### Minimal Node queue integration

```js
const { StructClient } = require('../sdk/js/index.cjs')
const { PersistentQueue } = require('../sdk/js/persistent.cjs')
const keyId = process.env.STRUCT_KEY_ID
const client = new StructClient({ host: process.env.STRUCT_HOST, keyId,
  apiSecret: process.env.STRUCT_API_SECRET })
const queue = new PersistentQueue('./telemetry-queue.json', { keyId, capacity: 32 })
// Replace with bytes from your generated schema encoder.
queue.enqueue(1, Buffer.from([42]), { ttlSeconds: 86400 })
try {
  const result = await queue.flushOne(client)
  // Schedule a later wake after unknown; explicitly resolve expired/full errors.
  console.log(result.status)
} finally {
  queue.close()
}
```

Use one queue owner and a schema matching the payload. `enqueue` returning means
the local snapshot was committed; `flushOne` returning committed means the server
stored the event. Do not enqueue the same measurement again after an uncertain
send. After a process crash, inspect the lock and use explicit recovery as described
above. The C equivalents are `struct_queue_open`, `struct_queue_enqueue` and
cooperative `struct_queue_step`; ESP32 wraps these in `StructNvsQueue`.

### Automated coverage

`npm test` now includes database outbox rollback, duplicate event commits, expired
lease recovery, stale completion rejection, replay authorization and monotonic
command ACKs. Node tests cover signed command mutation, queue reopen/full/expiry,
and webhook retry classification. `sdk/c/tests/test_delivery.c` exercises torn
snapshot recovery, lost receipts, expiry/full, authenticated commands and the
execution/result-write crash window with real mbedTLS. These are local fault
injections, not proof of all possible distributed-system/hardware failures.
Frozen v4 and STRC fixtures in `sdk/tests/delivery-vectors.json` were constructed
independently with Python's standard-library HMAC and integer packing. Existing
v2/v3 compatibility fixtures are unchanged.
