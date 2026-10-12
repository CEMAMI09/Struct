import {it,expect} from 'vitest'
import {createRequire} from 'node:module'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocket} from 'node:dgram'
import {once} from 'node:events'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {unzipSync,strToU8} from 'fflate'
import {generateSecureV2NodeProject,embedSecureV2NodeSdk} from './secureV2Project'
import {ENVIRONMENTAL_PACKED} from './secureV2Schema'
const require=createRequire(import.meta.url)
it('runs the actual generated Node sender through local authenticated gateway and durable storage',async()=>{
 const previousKey=process.env.TCP_CREDENTIAL_KEY,previousFlag=process.env.STRUCT_SECURE_V2_ENABLED;process.env.TCP_CREDENTIAL_KEY='12'.repeat(32);process.env.STRUCT_SECURE_V2_ENABLED='true'
 const {createDatabase}=require('../../tests/database.cjs'),{processFrame}=require('../../tcp-server/ingest'),{encryptSecret}=require('../../tcp-server/auth'),{PersistentSequenceCounter}=require('../../sdk/js/secure-v2-counter.cjs')
 const db=await createDatabase(),directory=mkdtempSync(join(tmpdir(),'struct-node-starter-')),socket=createSocket('udp4'),user='80000000-0000-0000-0000-000000000001',org='80000000-0000-0000-0000-000000000002',device='80000000-0000-0000-0000-000000000003',secret='ab'.repeat(32)
 const scalar=async(sql:string,args:any[]=[])=>Object.values((await db.query(sql,args)).rows[0])[0] as any
 try{
 await db.query('insert into auth.users values($1,$2)',[user,'node-starter@example.invalid']);await db.query("insert into organizations(id,name) values($1,'Local sender')",[org]);await db.query("insert into devices(id,user_id,organization_id,name,api_key,key_id,api_secret_encrypted) values($1,$2,$3,'Node','node-starter','node-starter','v1:unused')",[device,user,org]);
 const credential=await scalar('select row_to_json(enroll_device_secure_v2($1,$2,$3,$4,$5,$6,false,0))',[device,org,encryptSecret(secret),'abab',encryptSecret('cd'.repeat(32)),Buffer.alloc(32,1)]);const id=Number(credential.wire_device_id)
 await db.query("select publish_secure_v2_schema_slot($1,$2,0,'bitpacked-v1',$3,3,null,null)",[device,org,JSON.stringify(ENVIRONMENTAL_PACKED)])
 const adapter={from(table:string){if(!['devices','secure_v2_credentials','secure_v2_schema_slots'].includes(table))throw new Error('Unexpected table');const filters:any[]=[];const q:any={select(){return q},eq(k:string,v:any){if(!/^[a-z_]+$/.test(k))throw new Error('Unsafe column');filters.push([k,v]);return q},async maybeSingle(){return {data:(await db.query(`select * from ${table} where ${filters.map(([k],i)=>`${k}=$${i+1}`).join(' and ')}`,filters.map(([,v])=>v))).rows[0]}}};return q},async rpc(name:string,args:any){if(name!=='ingest_secure_v2_telemetry')throw new Error('Unexpected RPC');try{return {data:await scalar('select ingest_secure_v2_telemetry($1,$2,$3,$4,$5)',[args.p_wire_device_id,args.p_sequence,Buffer.from(args.p_frame_digest.slice(2),'hex'),args.p_schema_slot,JSON.stringify(args.p_records)])}}catch(e:any){return {error:{message:e.message}}}}}
 let failure:unknown,tamperChecked=false;socket.on('message',async(frame,remote)=>{try{if(!tamperChecked){const tampered=Buffer.from(frame);tampered[tampered.length-1]=tampered[tampered.length-1]!^1;await expect(processFrame(tampered,{supabase:adapter,transport:'udp'})).rejects.toThrow(/authentication/);expect(await scalar('select first_telemetry_at from organizations')).toBeNull();tamperChecked=true}const result=await processFrame(frame,{supabase:adapter,transport:'udp'});if(result.receipt)socket.send(result.receipt,remote.port,remote.address)}catch(e){failure=e}});socket.bind(0,'127.0.0.1');await once(socket,'listening');const address=socket.address();if(typeof address==='string')throw new Error('Expected address')
 const slot={slot:0,encoding:'bitpacked-v1' as const,record_bytes:3,schema_definition:ENVIRONMENTAL_PACKED};const generated=generateSecureV2NodeProject({slot,credentials:{wireDeviceId:id,rootSecret:secret,bootstrapToken:'cd'.repeat(32)}});generated['private-config.json']=JSON.stringify({wireDeviceId:id,rootSecret:secret,host:'127.0.0.1',port:address.port});generated['sample.json']=JSON.stringify({temperature:23.5,humidity:61.25,active:true});const archive=unzipSync(new Uint8Array(readFileSync(new URL('../public/sdk/struct-sdk.zip',import.meta.url))));const files=embedSecureV2NodeSdk(Object.fromEntries(Object.entries(generated).map(([k,v])=>[k,strToU8(v)])),archive)
 for(const [name,data] of Object.entries(files)){const file=join(directory,name);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,data)}
 // Test-only trusted initial reservation: production generated code never requests it.
 const counter=new PersistentSequenceCounter(join(directory,'counter.json'),{wireDeviceId:id,rootSecret:secret,trustedProvisioning:true});counter.close()
 const result=await promisify(execFile)(process.execPath,[join(directory,'send.cjs')],{timeout:15000});expect(failure).toBeUndefined();expect(tamperChecked).toBe(true);expect(JSON.parse(result.stdout)).toMatchObject({status:'committed',payload_bytes:3,frame_bytes:28});const decoded=await scalar('select parsed_json from telemetry');expect(decoded.temperature).toBe(23.5);expect(decoded.active).toBe(true);expect(decoded.humidity).toBeCloseTo(61.3,12);expect(await scalar('select first_telemetry_at from organizations')).toBeTruthy();await db.exec('delete from telemetry');expect(await scalar('select first_telemetry_at from organizations')).toBeTruthy()
 }finally{socket.close();await db.close();rmSync(directory,{recursive:true,force:true});if(previousKey===undefined)delete process.env.TCP_CREDENTIAL_KEY;else process.env.TCP_CREDENTIAL_KEY=previousKey;if(previousFlag===undefined)delete process.env.STRUCT_SECURE_V2_ENABLED;else process.env.STRUCT_SECURE_V2_ENABLED=previousFlag}
},30000)
