# Struct Python SDK

Version 0.2.0 release candidate, Python 3.10+. Install locally with
`pip install './sdk/python[encryption]'`. The encryption extra uses maintained
`cryptography` ChaCha20-Poly1305, never a custom cipher. Registry publication is
gated on ownership, license selection and release evidence.

```python
import os
from struct_device import StructClient
device = StructClient('127.0.0.1', os.environ['STRUCT_KEY_ID'],
                      os.environ['STRUCT_API_SECRET'],
                      encryption_key=os.getenv('STRUCT_ENCRYPTION_KEY'))
result = device.send(1, bytes([42]), confirmed=True)
```

Use a generated schema encoder for real readings. `async_send` runs the bounded
send in a worker thread; canceling the await does not undo delivery and the worker
retains client ownership until completion. Endpoint must be numeric IPv4.
`struct_persistent.PersistentQueue` owns durable v4 telemetry; `struct_commands`
provides STRC verification and a durable command receiver. Commands require an
application TCP stream adapter and idempotent action handler, as in Node.

Queues are capped, single writer and plaintext at rest. An expired head remains
until explicitly discarded. Unknown delivery remains queued. Close/reopen after
storage errors. The OS releases the queue lock when a process dies, so reopen
normally after a crash; a live writer still prevents a second owner. The `.lock`
sidecar remains in place to keep all processes locking the same file. Python,
Node and Rust queue files are not interchangeable. Use OS storage encryption.
