# Struct telemetry contract — preview, revision 1 baseline

**Revision 2 additions:** [Dependable delivery](DEPENDABLE-DELIVERY.md) supersedes
the unsupported persistent queue, unsigned command and best-effort telemetry
webhook statements below. This baseline preserves v2/v3 semantics; v4 and STRC
are explicit new formats. No existing wire version is repurposed.

Status: describes the current v2/v3 implementation; not a production SLA.
Changes to this contract require compatibility review and matching tests.

## Intended workload

Small, intermittent readings from battery-powered sensors and metered cellular
devices. The initial objective is low integration effort and bounded transmission
work. Sustained streams, firmware distribution, and hard real-time control are
not the current telemetry protocol's target. No measured power saving is promised.

## Delivery modes and outcomes

- Send once: protocol 2 over UDP. `sent` means accepted by the local socket;
  it does not establish remote receipt, authentication, or storage. No retry or
  receipt wait. TCP v2 also has no application storage acknowledgment.
- Confirmed storage: protocol 3 over UDP. `committed` means the client verified a
  signed receipt bound to its exact frame, issued after the database transaction
  committed. It does not mean a webhook arrived or a business action completed.
- Persistent offline: NOT IMPLEMENTED. Current clients retain one in-flight
  message in RAM. There is no durable queue or automatic restart recovery.
- `unknown`: the receipt deadline expired, or delivery became uncertain. The
  row may already exist. Do not interpret this as a guaranteed failure.
- Local validation/transport errors are returned as SDK errors. An error after
  transmission must not be treated as proof that the server stored nothing.

Receipt status 0 means this transaction inserted the sample; status 1 means an
identical accepted frame was previously committed. Both mean committed. Storage
includes the replay record, telemetry row and last-seen update in one transaction.
Database rollback consumes no nonce. Fleet registration is a separate transaction:
a new device may exist even when its first telemetry transaction fails.

No authenticated rejection response is currently defined. Invalid auth, schema,
timestamp, rate-limited traffic, and storage errors may all produce silence.
Credentials authenticate possession of a key, not firmware integrity.

## Identity, ordering, duplicates and expiry

Within the accepted timestamp window, device ID plus the 12-byte nonce identifies
a transmission. The stored SHA-256 digest covers the authenticated frame body.
An identical retransmission does not insert another row or dispatch another
telemetry webhook; changed bytes with that nonce are rejected. Re-signing an old
reading with a new nonce creates a new transmission and can create another row.

There is no global, per-device, or cross-transport ordering guarantee. TCP carries
ordered bytes on one connection; that does not establish order across reconnects
or parallel gateways. The stored telemetry timestamp represents server insertion
time, not a guaranteed sensor observation time. Include observation time/sequence
in the application schema if needed. Schema field order is significant.

The default allowed timestamp skew is 60 seconds relative to gateway/database
clocks. Configure consistent clocks and skew on all gateways (database permits
1..3600 seconds). Late identical frames are rejected even if once committed.
Replay records must remain through their full acceptance window; purging them
early breaks deduplication. Telemetry retention is separate and plan-dependent:
a receipt is not an indefinite retention or disaster-recovery guarantee.

Devices must obtain credible Unix time and cryptographically secure random nonces
after boot. Never restart a deterministic nonce sequence after reset. An encrypted
message also needs a fresh encryption nonce under its encryption key. A lost RAM
queue after reset cannot be recovered by the current SDK. Credentials may survive
reset only in appropriately protected application storage.

## Bounded retry contract

Confirmed defaults: one retry, initial delay 3000 ms with jitter, deadline 7500 ms.
SDK configuration allows 0..3 retries, initial delay 1000..30000 ms and total
budget 1..30000 ms. Retries reuse identical frame bytes. There is no automatic
downgrade to send-once. One in-flight transmission per client is supported.

The C deadline assumes timely polling and nonblocking callbacks; it is not a
hard real-time guarantee. Node timers depend on event-loop scheduling. Node's
budget includes socket/DNS setup; C adapter initialization and Python's caller
network setup do not. Radio startup, registration, clock synchronization, and
radio tail time are not bounded by this protocol. New-sample pacing is owned by
the application; the retry policy is not general congestion control.

## Persistent offline delivery preview

Protocol 4 uses a stable 16-byte event ID with fresh authenticated transmissions.
The database retains event identity for the device lifetime. C/Node bounded queues
persist before sending and retain uncertain outcomes. Full or expired queues never
silently discard samples. Observation time belongs in the application's schema;
transport time is refreshed. See [queue semantics and flash limits](DEPENDABLE-DELIVERY.md)
for credential changes, crash recovery and caller-owned reconnect pacing. Physical
power-loss qualification remains a release gate.

## Compatibility and security boundaries

v2 unconfirmed telemetry remains accepted alongside v3 confirmed UDP. v3 over
TCP and schema-zero v3 frames are rejected. Old gateways do not support v3.
Deploy migrations 020/021 and replace old gateways before enabling v3 clients.
Never repurpose a version byte or silently downgrade security/delivery behavior.

Device schema versions are 1..255, immutable after publication. Version 0 is
reserved for legacy command acknowledgments. Do not wrap version 255 to 1 or
reuse old versions. Fleet credentials currently use profile schema version 1;
new fleet layouts require a new profile/key rollout. Encryption is configured
per device, not inferred from packet content. Fleet plaintext must not bypass
an encrypted device's requirement.

Current downlinks use authenticated STRC envelopes with expiry and durable command
journals. Legacy unsigned envelopes are no longer sent. Telemetry webhooks use a
transactional outbox with bounded retries and controlled replay; connection events
remain best effort. An execution/result-journal crash can leave execution unknown.
Credential rotation invalidates old credentials; overlap/recovery is not yet a
guaranteed lifecycle feature. Master fleet credentials have a shared blast radius.

See [wire specification](PROTOCOL.md), [release gates](RELEASE-GATES.md), and
[SDK guide](../sdk/README.md).
