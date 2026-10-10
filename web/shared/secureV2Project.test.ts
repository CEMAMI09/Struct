import {describe,it,expect} from 'vitest'
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {unzipSync,strToU8} from 'fflate'
import {generateSecureV2Project,embedSecureV2Sdk,SECURE_V2_BOARDS} from './secureV2Project'
import {ENVIRONMENTAL_PACKED,slotRecordBytes,generateV2PacketHeader,type SecureV2Slot} from './secureV2Schema'
const credentials={wireDeviceId:270544960,rootSecret:'01'.repeat(32),bootstrapToken:'02'.repeat(32)} // TEST ONLY
const slot:SecureV2Slot={slot:3,encoding:'bitpacked-v1',schema_definition:ENVIRONMENTAL_PACKED,record_bytes:3}
describe('Secure V2 complete firmware export',()=>{
 it('generates exact schema, private config, board flags, versioned library and beginner workflow',()=>{
  for(const board of SECURE_V2_BOARDS){
   const project=generateSecureV2Project({slot,credentials,board})
   for(const name of ['src/main.cpp','include/struct_config.h','include/struct_packet.h','platformio.ini','README.md','schema.json','.gitignore','lib/Struct/library.json'])expect(project[name],name).toBeTruthy()
   expect(project['include/struct_config.h']).toContain(credentials.rootSecret)
   expect(project['include/struct_config.h']).toContain('STRUCT_DEVICE_ID 270544960u')
   expect(project['include/struct_config.h']).toContain(credentials.bootstrapToken)
   expect(project['include/struct_packet.h']).toContain('STRUCT_PACKET_BITS 22u')
   expect(project['include/struct_packet.h']).toContain('STRUCT_SCHEMA_SLOT 3u')
   expect(project['platformio.ini']).toContain(`board = ${board}`)
   expect(project['README.md']).toContain('ingest.usestruct.com on UDP 8081')
   expect(project['src/main.cpp']).toContain('client.send(STRUCT_SCHEMA_SLOT')
   expect(project['src/main.cpp']).not.toMatch(/127\.0\.0\.1|DigitalOcean|Supabase/)
   expect(project['.gitignore']).toContain('include/struct_config.h')
  }
  expect(()=>generateSecureV2Project({slot,credentials:{...credentials,rootSecret:'bad'},board:'esp32dev'})).toThrow('credentials')
  expect(()=>generateV2PacketHeader({...slot,record_bytes:9})).toThrow('size')
 })
 it('keeps legacy 9-byte payload encoding separate',()=>{
  const legacy:SecureV2Slot={slot:0,encoding:'legacy-le-v1',record_bytes:9,legacy_schema_version:7,schema_definition:[{name:'temp',type:'float32'},{name:'humidity',type:'float32'},{name:'active',type:'boolean'}]}
  expect(slotRecordBytes(legacy.schema_definition,legacy.encoding)).toBe(9)
  const header=generateV2PacketHeader(legacy);expect(header).toContain('STRUCT_PACKET_SIZE 9u');expect(header).toContain('struct_put_f32');expect(header).toContain('STRUCT_SCHEMA_VERSION 7')
 })
 it.each(SECURE_V2_BOARDS)('embeds the real downloadable SDK and builds %s when PlatformIO is available',(board)=>{
  const archive=unzipSync(new Uint8Array(readFileSync(new URL('../public/sdk/struct-sdk.zip',import.meta.url))))
  const files=generateSecureV2Project({slot,credentials,board,confirmed:true})
  const project=embedSecureV2Sdk(Object.fromEntries(Object.entries(files).map(([name,source])=>[name,strToU8(source)])),archive)
  const sdkHeader=new TextDecoder().decode(project['lib/Struct/src/struct_secure_v2.h'])
  expect(sdkHeader).toContain('"ingest.usestruct.com"');expect(sdkHeader).toContain('STRUCT_DEFAULT_UDP_PORT 8081u')
  expect(project['lib/Struct/src/third_party/mbedtls/chachapoly.inc']).toBeTruthy()
  expect(project['lib/Struct/src/third_party/mbedtls/LICENSE.txt']).toBeTruthy()
  expect(project['lib/Struct/src/third_party/mbedtls3/chachapoly.inc']).toBeTruthy()
  expect(project['lib/Struct/src/third_party/mbedtls3/LICENSE.txt']).toBeTruthy()
  expect(project['lib/Struct/src/struct_sdk.c']).toBeTruthy()
  const candidates=[process.env.STRUCT_PLATFORMIO,'pio','platformio',process.env.USERPROFILE?join(process.env.USERPROFILE,'.platformio','penv','Scripts','pio.exe'):''].filter(Boolean) as string[]
  const pio=candidates.find(candidate=>spawnSync(candidate,['--version'],{encoding:'utf8'}).status===0)
  if(!pio){console.log('PlatformIO unavailable; real generated-project build not executed');return}
  const temp=mkdtempSync(join(tmpdir(),'struct-secure-v2-project-'))
  try{
   for(const [name,content] of Object.entries(project)){const target=resolve(temp,name);if(!target.startsWith(resolve(temp)+requireSeparator()))throw new Error('Unsafe generated path');mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content)}
   const built=spawnSync(pio,['run','-d',temp],{encoding:'utf8',timeout:540000,maxBuffer:8*1024*1024})
   if(built.status!==0)throw new Error(`Generated ${board} build failed:\n${built.stdout}\n${built.stderr}`)
   console.log(`Generated self-contained ${board} PlatformIO project built successfully`)
  }finally{if(resolve(temp).startsWith(resolve(tmpdir())+requireSeparator()))rmSync(temp,{recursive:true,force:true})}
 },600000)
})
function requireSeparator(){return process.platform==='win32'?'\\':'/'}
