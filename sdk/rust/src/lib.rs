//! Struct host client. UDP transport owns signing, encryption, receipts and retries.
//! `start`/`poll` are cooperative; `send` is a bounded blocking convenience.
use chacha20poly1305::{aead::{Aead, KeyInit}, ChaCha20Poly1305, Nonce};
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io, net::{SocketAddr, UdpSocket}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use zeroize::Zeroizing;
pub mod persistent;
type Hmac256 = Hmac<Sha256>;
fn invalid(message: &str) -> io::Error { io::Error::new(io::ErrorKind::InvalidInput, message) }
fn sign(secret: &[u8], body: &[u8]) -> Vec<u8> {
    let mut h = <Hmac256 as Mac>::new_from_slice(secret).expect("HMAC accepts any key length");
    h.update(body); h.finalize().into_bytes().to_vec()
}
fn verify(secret: &[u8], body: &[u8], signature: &[u8]) -> bool {
    let mut h = <Hmac256 as Mac>::new_from_slice(secret).expect("HMAC accepts any key length");
    h.update(body); h.verify_slice(signature).is_ok()
}
fn random<const N: usize>() -> io::Result<[u8; N]> {
    let mut result=[0;N];OsRng.try_fill_bytes(&mut result).map_err(|_| invalid("OS RNG unavailable"))?;Ok(result)
}
fn unix_time() -> io::Result<u32> { SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|invalid("Clock invalid"))?.as_secs().try_into().map_err(|_|invalid("Clock out of range")) }
fn fingerprint(bytes: &[u8]) -> String { Sha256::digest(bytes).iter().map(|b|format!("{b:02x}")).collect() }

#[derive(Clone, Copy)]
pub struct Delivery { pub confirmed: bool, pub max_retries: u8, pub retry_ms: u32, pub budget_ms: u32 }
impl Default for Delivery { fn default()->Self { Self {confirmed:false,max_retries:1,retry_ms:3000,budget_ms:7500} } }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="snake_case")]
pub enum Status { Sent, Committed, Unknown }
#[derive(Debug, Serialize)]
pub struct Outcome { pub status: Status, pub attempts:u8, pub duplicate:bool, pub packet_id:String }
struct Flight { socket:UdpSocket, frame:Zeroizing<Vec<u8>>, started:Instant, next:Instant, delivery:Delivery, attempts:u8 }
pub struct Client { key_id:String, secret:Zeroizing<String>, encryption_key:Option<Zeroizing<[u8;32]>>, endpoint:SocketAddr, flight:Option<Flight> }
impl Client {
 pub fn key_id(&self)->&str{&self.key_id}
 pub fn new(endpoint:SocketAddr,key_id:&str,api_secret:&str)->io::Result<Self>{
  if key_id.len()!=16 || !key_id.bytes().all(|c|(33..=126).contains(&c)) || api_secret.len()!=64 || !api_secret.bytes().all(|c|c.is_ascii_hexdigit()) || endpoint.port()==0 {return Err(invalid("Invalid endpoint or credentials"))}
  Ok(Self{key_id:key_id.into(),secret:Zeroizing::new(api_secret.into()),encryption_key:None,endpoint,flight:None})
 }
 pub fn set_encryption(&mut self,key:Option<[u8;32]>)->io::Result<()> {if self.flight.is_some(){return Err(invalid("Client busy"))}self.encryption_key=key.map(Zeroizing::new);Ok(())}
 pub fn set_encryption_hex(&mut self,text:&str)->io::Result<()>{
  if text.len()!=64||!text.bytes().all(|c|c.is_ascii_hexdigit()){return Err(invalid("Encryption key must be 64 hex characters"))}
  let mut key=Zeroizing::new([0u8;32]);for i in 0..32{key[i]=u8::from_str_radix(&text[i*2..i*2+2],16).map_err(|_|invalid("Encryption key"))?}self.set_encryption(Some(*key))
 }
 fn frame(&self,version:u8,payload:&[u8],d:Delivery,event:Option<[u8;16]>,time:u32,nonce:[u8;12],enc_nonce:[u8;12])->io::Result<Vec<u8>>{
  if version==0 || payload.is_empty() || time==0 || (event.is_some()&&!d.confirmed){return Err(invalid("Invalid frame"))}
  let mut region=Zeroizing::new(Vec::new());if let Some(id)=event {region.extend_from_slice(&id)}region.extend_from_slice(payload);
  if region.len()>1334-if self.encryption_key.is_some(){32}else{0}{return Err(invalid("Frame exceeds 1400 bytes"))}
  if let Some(key)=&self.encryption_key {
   let mut plain=Zeroizing::new(time.to_le_bytes().to_vec());plain.extend_from_slice(&region);
   let cipher=ChaCha20Poly1305::new_from_slice(&key[..]).map_err(|_|invalid("Encryption key"))?;
   let encrypted=cipher.encrypt(Nonce::from_slice(&enc_nonce),plain.as_slice()).map_err(|_|invalid("Encryption failed"))?;
   region.clear();region.extend_from_slice(&enc_nonce);region.extend_from_slice(&encrypted);
  }
  let mut body=vec![if event.is_some(){4}else if d.confirmed{3}else{2}];body.extend_from_slice(self.key_id.as_bytes());body.push(version);body.extend_from_slice(&time.to_le_bytes());body.extend_from_slice(&nonce);body.extend_from_slice(&region);
  let mac=sign(self.secret.as_bytes(),&body);body.extend_from_slice(&mac);Ok(body)
 }
 pub fn start(&mut self,version:u8,payload:&[u8],delivery:Delivery,event:Option<[u8;16]>)->io::Result<Option<Outcome>>{
  if self.flight.is_some(){return Err(invalid("Client busy"))}
  if delivery.max_retries>3 || !(1000..=30000).contains(&delivery.retry_ms) || !(1..=30000).contains(&delivery.budget_ms){return Err(invalid("Invalid delivery budget"))}
  let frame=Zeroizing::new(self.frame(version,payload,delivery,event,unix_time()?,random()?,random()?)?);
  let started=Instant::now();let socket=UdpSocket::bind(if self.endpoint.is_ipv4(){"0.0.0.0:0"}else{"[::]:0"})?;socket.connect(self.endpoint)?;socket.set_nonblocking(true)?;
  let packet_id=fingerprint(&frame);
  if started.elapsed()>=Duration::from_millis(delivery.budget_ms.into()){return Ok(Some(Outcome{status:Status::Unknown,attempts:0,duplicate:false,packet_id}))}
  if socket.send(&frame)?!=frame.len(){return Err(invalid("Partial datagram"))}
  if !delivery.confirmed{return Ok(Some(Outcome{status:Status::Sent,attempts:1,duplicate:false,packet_id}))}
  let jitter=u32::from_le_bytes(random()?)%(delivery.retry_ms/4+1);
  self.flight=Some(Flight{socket,frame,started,next:Instant::now()+Duration::from_millis((delivery.retry_ms+jitter).into()),delivery,attempts:1});Ok(None)
 }
 pub fn poll(&mut self)->io::Result<Option<Outcome>>{
  let Some(f)=self.flight.as_mut() else{return Err(invalid("No pending send"))};
  let mut status=None;let mut duplicate=false;
  if f.started.elapsed()>=Duration::from_millis(f.delivery.budget_ms.into()){status=Some(Status::Unknown)}else{
   let mut receipt=[0u8;70];
   match f.socket.recv(&mut receipt){
    Ok(69) if &receipt[..4]==b"STRA" && receipt[36]<=1 && receipt[4..36]==f.frame[f.frame.len()-32..] && verify(self.secret.as_bytes(),&receipt[..37],&receipt[37..69])=>{status=Some(Status::Committed);duplicate=receipt[36]==1},
    Err(e) if !matches!(e.kind(),io::ErrorKind::WouldBlock|io::ErrorKind::Interrupted)=>status=Some(Status::Unknown),_=>{}
   }
   if status.is_none() && Instant::now()>=f.next && f.attempts<=f.delivery.max_retries {
    f.attempts+=1;
    if f.socket.send(&f.frame).ok()!=Some(f.frame.len()){status=Some(Status::Unknown)}
    f.next=Instant::now()+Duration::from_millis(u64::from(f.delivery.retry_ms)*(1u64<<(f.attempts-1)));
   }
  }
  if let Some(status)=status{let outcome=Outcome{status,attempts:f.attempts,duplicate,packet_id:fingerprint(&f.frame)};self.flight=None;Ok(Some(outcome))}else{Ok(None)}
 }
 pub fn cancel(&mut self)->Option<Outcome>{self.flight.take().map(|f|Outcome{status:Status::Unknown,attempts:f.attempts,duplicate:false,packet_id:fingerprint(&f.frame)})}
 pub fn send(&mut self,version:u8,payload:&[u8],delivery:Delivery,event:Option<[u8;16]>)->io::Result<Outcome>{
  if let Some(result)=self.start(version,payload,delivery,event)?{return Ok(result)}
  loop{if let Some(result)=self.poll()?{return Ok(result)}std::thread::sleep(Duration::from_millis(1))}
 }
 pub fn verify_command(&self,frame:&[u8],now:u32)->io::Result<Command>{
  if !(77..=1400).contains(&frame.len()) || &frame[..4]!=b"STRC" || &frame[4..20]!=self.key_id.as_bytes() || !verify(self.secret.as_bytes(),&frame[..frame.len()-32],&frame[frame.len()-32..]){return Err(invalid("Invalid command authentication"))}
  let issued=u32::from_le_bytes(frame[36..40].try_into().unwrap());let expires=u32::from_le_bytes(frame[40..44].try_into().unwrap());
  if u64::from(issued)>u64::from(now)+60 || expires<=issued{return Err(invalid("Invalid command clock"))}
  Ok(Command{id:frame[20..36].try_into().unwrap(),expires,expired:expires<=now,payload:frame[44..frame.len()-32].to_vec(),fingerprint:frame[frame.len()-32..].try_into().unwrap()})
 }
 pub fn command_ack(&self,id:[u8;16],status:u8)->io::Result<Vec<u8>>{if !(16..=20).contains(&status){return Err(invalid("Invalid command status"))}let mut body=vec![2];body.extend_from_slice(self.key_id.as_bytes());body.push(0);body.extend_from_slice(&id);body.push(status);let mac=sign(self.secret.as_bytes(),&body);body.extend_from_slice(&mac);Ok(body)}
}
pub struct Command {pub id:[u8;16],pub expires:u32,pub expired:bool,pub payload:Vec<u8>,pub fingerprint:[u8;32]}

#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn frozen_plain_frames(){
  let fixtures:serde_json::Value=serde_json::from_str(include_str!("../tests/fixtures/protocol-vectors.json")).unwrap();
  for v in fixtures["vectors"].as_array().unwrap(){
   let mut client=Client::new("127.0.0.1:8081".parse().unwrap(),v["keyId"].as_str().unwrap(),v["apiSecret"].as_str().unwrap()).unwrap();
   if let Some(key)=v["encryptionKey"].as_str(){client.set_encryption_hex(key).unwrap();}
   let d=Delivery{confirmed:v["protocol"]==3,..Delivery::default()};
   let enc_nonce=v["encryptionNonceHex"].as_str().map(|s|hex::decode(s).unwrap().try_into().unwrap()).unwrap_or([0;12]);
   let frame=client.frame(v["schemaVersion"].as_u64().unwrap() as u8,&hex::decode(v["payloadHex"].as_str().unwrap()).unwrap(),d,None,v["timestampSec"].as_u64().unwrap() as u32,hex::decode(v["nonceHex"].as_str().unwrap()).unwrap().try_into().unwrap(),enc_nonce).unwrap();
   assert_eq!(hex::encode(frame),v["frameHex"].as_str().unwrap());
  }
 }
 #[test] fn command_vector(){let v:serde_json::Value=serde_json::from_str(include_str!("../tests/fixtures/delivery-vectors.json")).unwrap();let c=Client::new("127.0.0.1:8081".parse().unwrap(),v["keyId"].as_str().unwrap(),v["apiSecret"].as_str().unwrap()).unwrap();let frame=hex::decode(v["commandHex"].as_str().unwrap()).unwrap();assert!(!c.verify_command(&frame,1001).unwrap().expired);assert!(c.verify_command(&frame,2000).unwrap().expired);}
 #[test] fn receipt_loss_retries_identical_bytes(){
  let server=UdpSocket::bind("127.0.0.1:0").unwrap();server.set_read_timeout(Some(Duration::from_secs(3))).unwrap();let address=server.local_addr().unwrap();
  let receiver=std::thread::spawn(move||{let mut a=[0;1400];let(n,peer)=server.recv_from(&mut a).unwrap();let first=a[..n].to_vec();let(m,_)=server.recv_from(&mut a).unwrap();assert_eq!(&first,&a[..m]);let mut receipt=b"STRA".to_vec();receipt.extend_from_slice(&a[m-32..m]);receipt.push(1);receipt.extend_from_slice(&sign("a".repeat(64).as_bytes(),&receipt));server.send_to(&receipt,peer).unwrap();});
  let mut client=Client::new(address,"0123456789abcdef",&"a".repeat(64)).unwrap();let result=client.send(1,&[42],Delivery{confirmed:true,retry_ms:1000,budget_ms:2500,max_retries:1},None).unwrap();assert_eq!(result.status,Status::Committed);assert_eq!(result.attempts,2);assert!(result.duplicate);receiver.join().unwrap();
 }
 #[test] fn durable_queue_and_command_reopen(){
  let root=std::env::temp_dir().join(format!("struct-rust-{}",u64::from_le_bytes(random().unwrap())));std::fs::create_dir(&root).unwrap();
  let file=root.join("queue.json");let key="0123456789abcdef";
  {let mut q=persistent::Queue::open(&file,key,1).unwrap();q.enqueue(1,&[42],u32::MAX).unwrap();assert!(q.enqueue(1,&[43],u32::MAX).is_err());assert!(persistent::Queue::open(&file,key,1).is_err());}
  {let q=persistent::Queue::open(&file,key,1).unwrap();assert_eq!(q.len(),1);}
  let v:serde_json::Value=serde_json::from_str(include_str!("../tests/fixtures/delivery-vectors.json")).unwrap();let client=Client::new("127.0.0.1:8081".parse().unwrap(),key,v["apiSecret"].as_str().unwrap()).unwrap();let frame=hex::decode(v["commandHex"].as_str().unwrap()).unwrap();
  let journal=root.join("commands.json");let mut calls=0;
  for _ in 0..2{let mut j=persistent::CommandJournal::open(&journal,key,1).unwrap();assert_eq!(j.handle(&client,&frame,1001,|_|{calls+=1;17},|_|Ok(())).unwrap(),17);}assert_eq!(calls,1);
  for name in ["queue.json","queue.lock","commands.json","commands.lock"]{std::fs::remove_file(root.join(name)).unwrap()}std::fs::remove_dir(root).unwrap();
 }
}
