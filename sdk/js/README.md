# Struct Node SDK

Version 0.3.0 release candidate. Requires Node 20 or newer. Public registry
publication is gated on package ownership, license selection and release evidence.

```js
const {StructClient}=require('@struct/device')
const client=new StructClient({host:process.env.STRUCT_HOST,
 keyId:process.env.STRUCT_KEY_ID,apiSecret:process.env.STRUCT_API_SECRET,
 encryptionKey:process.env.STRUCT_ENCRYPTION_KEY})
const result=await client.send(1,Buffer.from([42]),{confirmed:true})
```

Use generated encoders instead of the sample byte for real schemas. Optional
modules are `@struct/device/persistent` and `@struct/device/command-receiver`.
One send per client at a time; APIs return promises. No browser UDP support.
Storage receipts confirm committed telemetry, not downstream delivery. Timeout
means unknown; never blindly enqueue a measurement twice. Persistent queues have
explicit capacity/expiry and retain stable event IDs across retries/restarts.
Command journals persist intent before invoking your handler. Supply TCP framing,
ACK transport and idempotent actions; transport encryption for downlinks is not
included. SDK handles STRC authentication and execution deduplication.
# Struct Secure V2 (additive)

`SecureV2Client` sends encrypted telemetry to `ingest.usestruct.com:8081` by
default. Enroll a device explicitly and publish an immutable schema slot first.
Legacy `StructClient` behavior and credentials are unchanged.

Use one root credential on exactly one device/process. Keep the root and one-time
bootstrap token in your secret configuration. Never commit them to source control.

```js
const { SecureV2Client, PersistentSequenceCounter } = require('./index.cjs')
const credentials = {
  wireDeviceId: Number(process.env.STRUCT_WIRE_DEVICE_ID),
  rootSecret: process.env.STRUCT_DEVICE_SECRET,
}
// Once, on a fresh credential and durable filesystem:
const counter = await PersistentSequenceCounter.provision('struct-counter.json', {
  ...credentials, bootstrapToken: process.env.STRUCT_BOOTSTRAP_TOKEN,
})
// On subsequent starts use new PersistentSequenceCounter('struct-counter.json', credentials).
const client = new SecureV2Client({ ...credentials, counter })
const result = await client.send(0, encodedPayload, { confirmed: true })
counter.close()
```

The counter reserves 1024 numbers with an atomic rename/fsync before returning
any number, skips unused reserved numbers after restart, and refuses missing or
corrupt state. Its lock permits one writer. Explicit `recover: true` only removes
a stale lock after confirming its process no longer exists. Windows lacks the
POSIX directory-fsync operation; qualify your filesystem for power-loss durability
before deployment. Backups/rollback/cloning of counter state are unsafe: rotate
the root and wire ID after state loss, and never restore an old counter backup.
`trustedProvisioning: true` is only for initial trusted manufacturing/test setup
before a credential has ever transmitted; it is not an erase/reset recovery mode.

Confirmed retries resend the same ciphertext and accept a 21-byte authenticated
receipt only after database commit. `unknown` means no receipt was confirmed.
Unconfirmed returns `sent` without server acceptance proof. `sendBatch(slot,
equalSizeEncodedRecords, options)` splits records into bounded envelopes, with
one unique sequence per envelope. Delivery settings retain the legacy bounded
retry policy. Raw `secure-v2.cjs` framing functions require callers to guarantee
nonce uniqueness; application code should use the persistent-counter client.

Debugging: `node scripts/debug-send.cjs --v2 payload.bin --slot 0 --confirmed`
uses `STRUCT_WIRE_DEVICE_ID`, `STRUCT_DEVICE_SECRET`, and `STRUCT_COUNTER_FILE`.
Add `--bootstrap` only on first provisioning and set `STRUCT_BOOTSTRAP_TOKEN`.
`--batch-count N` interprets the file as N equal-size records. `STRUCT_HOST` and
`STRUCT_PORT` optionally override the production endpoint. Reports contain only
public metadata, sizes, fingerprints and outcomes.
