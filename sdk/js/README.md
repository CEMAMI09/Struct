# Struct Node SDK

Version 0.2.0 release candidate. Requires Node 20 or newer. Public registry
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
