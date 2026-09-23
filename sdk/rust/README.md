# Struct Rust host SDK

Source candidate, version 0.2.0. Not a no_std MCU crate. `Client` owns UDP,
HMAC, optional ChaCha20-Poly1305, framing, receipt validation and bounded retries.
`start`/`poll` support an event loop without sleeping; `send` waits cooperatively.
Call `cancel` to stop locally; its outcome is unknown, never revoked delivery.

```rust,no_run
use struct_device::{Client,Delivery};
fn main() -> std::io::Result<()> {
 let mut client=Client::new("127.0.0.1:8081".parse().unwrap(),
   &std::env::var("STRUCT_KEY_ID").expect("key ID"),
   &std::env::var("STRUCT_API_SECRET").expect("secret"))?;
 let result=client.send(1,&42u8.to_le_bytes(),Delivery{confirmed:true,..Delivery::default()},None)?;
 println!("{:?}",result.status);
 Ok(())
}
```

Set a decoded 32-byte encryption key with `set_encryption` before sending to an
encrypted device. Persistent `Queue` and `CommandJournal` use OS file locks and
atomic snapshots, capped at 256 records. Windows directory durability depends
on the filesystem. No automatic eviction or identity migration. Close/reopen
after uncertain storage. Files contain plaintext readings; use protected storage.
Use a separate filename for each language's queue (formats are not interchangeable).

The command journal accepts STRC inner envelopes. Your application supplies TCP
length-prefix reading and ACK writing, plus idempotent hardware actions. It commits
intent before execution; a panic/reset leaves unknown and never blindly reruns.
This library uses heap allocation and the OS RNG. Firmware should use portable C.
