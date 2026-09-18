const assert=require('node:assert/strict')
const {createDatabase}=require('./database.cjs')
async function run(){
 const db=await createDatabase()
 try {
 const u='10000000-0000-0000-0000-000000000001',o='10000000-0000-0000-0000-000000000002',d='10000000-0000-0000-0000-000000000003'
 await db.query('insert into auth.users values($1,$2)',[u,'delivery@example.invalid'])
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u])
 await db.query("insert into organizations(id,name,subscription_tier) values($1,$2,'pro')",[o,'Delivery'])
 await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')",[o,u])
 await db.query("insert into devices(id,user_id,organization_id,name,api_key,key_id) values($1,$2,$3,'sensor','test-delivery','test-delivery')",[d,u,o])
 await db.query("insert into destinations(user_id,organization_id,name,url) values($1,$2,'receiver','https://example.com/hook')",[u,o])
 const commit=()=>db.query("select ingest_device_telemetry($1,$2,now(),$3,'{}',60)",[d,Buffer.alloc(12,1),Buffer.alloc(32,2)])
 await db.exec("create function fail_outbox() returns trigger language plpgsql as $$ begin raise exception 'outbox unavailable'; end $$; create trigger fail_outbox before insert on webhook_deliveries for each row execute function fail_outbox();")
 await assert.rejects(commit(),/outbox unavailable/)
 assert.equal((await db.query('select count(*)::integer n from telemetry')).rows[0].n,0)
 assert.equal((await db.query('select count(*)::integer n from device_replay_nonces')).rows[0].n,0)
 await db.exec('drop trigger fail_outbox on webhook_deliveries')
 await commit();await commit()
 assert.equal((await db.query('select count(*)::integer n from webhook_deliveries')).rows[0].n,1)
 const job=(await db.query('select * from claim_webhook_deliveries(8)')).rows[0]
 assert.equal(job.body.id,job.event_id)
 assert.equal((await db.query('select * from claim_webhook_deliveries(8)')).rows.length,0)
 // Simulate a worker crash after remote success and before database completion.
 await db.query("update webhook_deliveries set lease_until=now()-interval '1 second' where id=$1",[job.id])
 const recovered=(await db.query('select * from claim_webhook_deliveries(8)')).rows[0]
 assert.equal(recovered.event_id,job.event_id);assert.notEqual(recovered.lease_token,job.lease_token)
 const finish=(token,outcome)=>db.query('select finish_webhook_delivery($1,$2,$3,null) ok',[job.id,token,outcome])
 assert.equal((await finish(job.lease_token,'delivered')).rows[0].ok,false)
 assert.equal((await finish(recovered.lease_token,'dead')).rows[0].ok,true)
 await db.query('select replay_webhook_delivery($1)',[job.id])
 assert.equal((await db.query('select replay_count from webhook_deliveries')).rows[0].replay_count,1)
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",['10000000-0000-0000-0000-000000000099'])
 await assert.rejects(db.query('select replay_webhook_delivery($1)',[job.id]),/Not authorized/)
 await db.query("insert into pending_commands(device_id,user_id,packed_hex) values($1,$2,'02')",[d,u])
 const cmd=(await db.query("select * from claim_pending_downlinks($1,'worker',1)",[d])).rows[0]
 const ack=code=>db.query('select acknowledge_pending_command($1,$2,$3::smallint) ok',[d,cmd.command_id,code])
 assert.equal((await ack(0)).rows[0].ok,false)
 assert.equal((await ack(16)).rows[0].ok,true)
 assert.equal((await ack(17)).rows[0].ok,true)
 assert.equal((await ack(16)).rows[0].ok,false)
 assert.equal((await db.query('select status from pending_commands')).rows[0].status,'executed')
 // Never report an attempted command as definitely unexecuted on expiry.
 for(const attempts of [0,1]){
  const expired=(await db.query("insert into pending_commands(device_id,user_id,packed_hex,attempt_count,expires_at) values($1,$2,'02',$3,now()-interval '1 second') returning id",[d,u,attempts])).rows[0]
  await db.query('select expire_pending_commands()')
  assert.equal((await db.query('select status from pending_commands where id=$1',[expired.id])).rows[0].status,attempts?'unknown':'expired')
 }
 const exhausted=(await db.query("insert into pending_commands(device_id,user_id,packed_hex,attempt_count) values($1,$2,'02',8) returning id",[d,u])).rows[0]
 await db.query("select * from claim_pending_downlinks($1,'worker',1)",[d])
 assert.equal((await db.query('select status from pending_commands where id=$1',[exhausted.id])).rows[0].status,'unknown')
 await db.query("update webhook_deliveries set attempts=7,next_attempt_at=now() where id=$1",[job.id])
 const lastTry=(await db.query('select * from claim_webhook_deliveries(8)')).rows[0]
 assert.equal(lastTry.attempts,8)
 await finish(lastTry.lease_token,'retry')
 assert.equal((await db.query('select status from webhook_deliveries where id=$1',[job.id])).rows[0].status,'dead')
 const queued=(nonce,digest)=>db.query("select ingest_queued_telemetry($1,$2,now(),$3,'{}',$4,$5,60) inserted",[d,Buffer.alloc(12,nonce),Buffer.alloc(32,nonce),Buffer.alloc(16,8),Buffer.alloc(32,digest)])
 assert.equal((await queued(3,9)).rows[0].inserted,true)
 assert.equal((await queued(4,9)).rows[0].inserted,false)
 await assert.rejects(queued(5,10),/EVENT_ID_CONFLICT/)
 assert.equal((await db.query('select count(*)::integer n from telemetry')).rows[0].n,2)
 assert.equal((await db.query('select count(*)::integer n from webhook_deliveries')).rows[0].n,2)
 console.log('Delivery database: atomic outbox rollback, duplicates, crash recovery, stale lease, controlled replay, monotonic command ACKs passed')
 } finally {await db.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1})
