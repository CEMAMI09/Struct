//! Durable single-writer host queues. Snapshots contain plaintext application data.
use super::*;
use fs2::FileExt;
use std::{fs::{self,File,OpenOptions},io::Write,path::{Path,PathBuf}};
#[derive(Clone,Serialize,Deserialize)]
struct Record {id:[u8;16],expires:u32,version:u8,payload:Vec<u8>,mac:Option<Vec<u8>>,status:Option<u8>}
#[derive(Serialize,Deserialize)]
struct Snapshot {version:u8,key_id:String,kind:String,records:Vec<Record>}
#[derive(Serialize,Deserialize)]
struct Envelope {snapshot:String,sha256:String}
struct Store {path:PathBuf,_lock:File,state:Snapshot,capacity:usize,failed:bool}
fn private_file(path:&Path)->io::Result<File>{let mut o=OpenOptions::new();o.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;o.mode(0o600);}o.open(path)}
impl Store {
 fn open(path:&Path,key:&str,capacity:usize,kind:&str)->io::Result<Self>{
  if key.len()!=16 || !(1..=256).contains(&capacity){return Err(invalid("Invalid queue configuration"))}
  let parent=path.parent().filter(|p|!p.as_os_str().is_empty()).unwrap_or(Path::new("."));fs::create_dir_all(parent)?;
  let lock=OpenOptions::new().create(true).truncate(false).read(true).write(true).open(path.with_extension("lock"))?;lock.try_lock_exclusive()?;
  let state=if path.exists(){
   if fs::metadata(path)?.len()>1_000_000{return Err(invalid("Queue too large"))}
   let envelope:Envelope=serde_json::from_slice(&fs::read(path)?).map_err(|_|invalid("Queue format"))?;
   if fingerprint(envelope.snapshot.as_bytes())!=envelope.sha256{return Err(invalid("Queue checksum"))}
   let state:Snapshot=serde_json::from_str(&envelope.snapshot).map_err(|_|invalid("Queue format"))?;
   if state.version!=1 || state.key_id!=key || state.kind!=kind || state.records.len()>capacity || state.records.iter().any(|r|if kind=="telemetry"{r.version==0||r.payload.is_empty()||r.payload.len()>1286}else{r.mac.as_ref().map(Vec::len)!=Some(32)||!r.status.map(|s|(16..=20).contains(&s)).unwrap_or(false)}){return Err(invalid("Queue identity or records invalid"))}state
  }else{Snapshot{version:1,key_id:key.into(),kind:kind.into(),records:vec![]}};
  Ok(Self{path:path.into(),_lock:lock,state,capacity,failed:false})
 }
 fn check(&self)->io::Result<()>{if self.failed{Err(invalid("Storage uncertain; reopen queue"))}else{Ok(())}}
 fn commit(&mut self,records:Vec<Record>)->io::Result<()>{
  self.check()?;
  let snapshot=serde_json::to_string(&Snapshot{version:1,key_id:self.state.key_id.clone(),kind:self.state.kind.clone(),records:records.clone()}).map_err(|_|invalid("Snapshot serialization"))?;
  let bytes=serde_json::to_vec(&Envelope{sha256:fingerprint(snapshot.as_bytes()),snapshot}).map_err(|_|invalid("Snapshot serialization"))?;
  let temporary=self.path.with_extension(format!("{}.tmp",u64::from_le_bytes(random()?)));
  let result=(||{let mut f=private_file(&temporary)?;f.write_all(&bytes)?;f.sync_all()?;drop(f);fs::rename(&temporary,&self.path)?;
   #[cfg(unix)] File::open(self.path.parent().filter(|p|!p.as_os_str().is_empty()).unwrap_or(Path::new(".")))?.sync_all()?;
   Ok(())})();
  if result.is_err(){self.failed=true;let _=fs::remove_file(&temporary);}else{self.state.records=records}result
 }
}
pub struct Queue(Store);
impl Queue {
 pub fn open(path:impl AsRef<Path>,key_id:&str,capacity:usize)->io::Result<Self>{Store::open(path.as_ref(),key_id,capacity,"telemetry").map(Self)}
 pub fn len(&self)->usize{self.0.state.records.len()}
 pub fn is_empty(&self)->bool{self.len()==0}
 pub fn enqueue(&mut self,version:u8,payload:&[u8],expires:u32)->io::Result<[u8;16]>{
  self.0.check()?;if version==0||payload.is_empty()||payload.len()>1286||expires==0||self.len()>=self.0.capacity{return Err(invalid("Invalid event or queue full"))}
  let id=random()?;let mut records=self.0.state.records.clone();records.push(Record{id,version,payload:payload.to_vec(),expires,mac:None,status:None});self.0.commit(records)?;Ok(id)
 }
 pub fn discard(&mut self,id:[u8;16])->io::Result<()>{self.0.check()?;if self.0.state.records.first().map(|r|r.id)!=Some(id){return Err(invalid("Only explicit head may be discarded"))}self.0.commit(self.0.state.records[1..].to_vec())}
 pub fn flush_one(&mut self,client:&mut Client,mut delivery:Delivery)->io::Result<Option<Outcome>>{
  self.0.check()?;if client.key_id!=self.0.state.key_id{return Err(invalid("Queue identity mismatch"))}
  let Some(head)=self.0.state.records.first().cloned() else{return Ok(None)};
  if head.expires<=unix_time()?{return Err(invalid("Queue head expired; explicit discard required"))}
  delivery.confirmed=true;let outcome=client.send(head.version,&head.payload,delivery,Some(head.id))?;
  if outcome.status==Status::Committed{self.discard(head.id)?}Ok(Some(outcome))
 }
}
pub struct CommandJournal(Store);
impl CommandJournal {
 pub fn open(path:impl AsRef<Path>,key_id:&str,capacity:usize)->io::Result<Self>{Store::open(path.as_ref(),key_id,capacity,"commands").map(Self)}
 pub fn handle(&mut self,client:&Client,frame:&[u8],now:u32,mut execute:impl FnMut(&Command)->u8,mut ack:impl FnMut(&[u8])->io::Result<()>)->io::Result<u8>{
  self.0.check()?;if self.0.state.key_id!=client.key_id{return Err(invalid("Journal identity mismatch"))}
  let command=client.verify_command(frame,now)?;
  let mut respond=|status|{ack(&client.command_ack(command.id,status)?)?;Ok(status)};
  if command.expired{return respond(19)}
  if let Some(previous)=self.0.state.records.iter().find(|r|r.id==command.id){
   if previous.mac.as_deref()!=Some(command.fingerprint.as_slice()){return Err(invalid("Command ID conflict"))}
   let status=previous.status.unwrap_or(20);return respond(if status==16{20}else{status})
  }
  let mut records:Vec<_>=self.0.state.records.iter().filter(|r|r.expires>now).cloned().collect();
  if records.len()>=self.0.capacity{return Err(invalid("Command journal full"))}
  records.push(Record{id:command.id,expires:command.expires,version:0,payload:vec![],mac:Some(command.fingerprint.to_vec()),status:Some(16)});self.0.commit(records.clone())?;respond(16)?;
  let result=execute(&command);let status=if result==17||result==18{result}else{20};records.last_mut().unwrap().status=Some(status);
  if self.0.commit(records).is_err(){return respond(20)}respond(status)
 }
}
