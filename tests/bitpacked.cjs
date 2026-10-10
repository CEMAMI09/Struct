const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process')
const p = require('../protocol/schema/bitpacked.cjs')
const environmental = [{name:'temperature',type:'fixed',min:-40,max:125,precision:0.1},{name:'humidity',type:'fixed',min:0,max:100,precision:0.1},{name:'active',type:'boolean'}]
function hex(values, schema) { return Buffer.from(p.encodePayload(values,schema)).toString('hex') }
assert.equal(p.compileSchema(environmental).bits,22)
assert.equal(hex({temperature:72.4,humidity:41.8,active:true},environmental),'8c8d14')
assert.equal(hex({temperature:-40,humidity:0,active:false},environmental),'000000')
assert.equal(hex({temperature:125,humidity:100,active:true},environmental),'ce5f44')
assert.equal(p.decodePayload(p.encodePayload({temperature:72.45,humidity:41.85,active:true},environmental),environmental).temperature,72.5)
assert.throws(()=>p.encodePayload({temperature:126,humidity:100,active:true},environmental),/range/)
const bools=Array.from({length:11},(_,i)=>({name:`b${i}`,type:'boolean'})), boolValues=Object.fromEntries(bools.map((f,i)=>[f.name,i%2===0]))
assert.equal(hex(boolValues,bools),'aaa0')
assert.deepEqual(p.decodePayload(p.encodePayload(boolValues,bools),bools),boolValues)
assert.throws(()=>p.decodePayload(Uint8Array.from([0xaa,0xa1]),bools),/padding/)
assert.throws(()=>p.decodePayload(Uint8Array.from([0xaa]),bools),/length/)
const ints=[{name:'u',type:'uint',width:32},{name:'i',type:'int',width:32},{name:'bits',type:'bitset',width:5},{name:'mode',type:'enum',values:['off','on','standby']}]
assert.equal(hex({u:4294967295,i:-2147483648,bits:31,mode:'standby'},ints),'ffffffff80000000fc')
assert.deepEqual(p.decodePayload(p.encodePayload({u:4294967295,i:-2147483648,bits:31,mode:'standby'},ints),ints),{u:4294967295,i:-2147483648,bits:31,mode:'standby'})
for(const [field,value] of [['u',4294967296],['i',2147483648],['bits',32],['mode','unknown']]) assert.throws(()=>p.encodePayload({u:0,i:0,bits:0,mode:'off',[field]:value},ints))
assert.throws(()=>p.decodePayload(Uint8Array.from([0xc0]),[{name:'mode',type:'enum',values:['a','b','c']}]),/enum/)
for(const width of [1,2,7,8,9,16,31,32]){
 const s=[{name:'u',type:'uint',width},{name:'i',type:'int',width}]
 for(const u of [0,2**width-1])for(const i of [-(2**(width-1)),2**(width-1)-1]) assert.deepEqual(p.decodePayload(p.encodePayload({u,i},s),s),{u,i})
}
for(const definition of [[],[{name:'x',type:'uint',width:33}],[{name:'x',type:'fixed',min:0,max:1,precision:0}],[{name:'x',type:'fixed',min:0,max:1,precision:1e-12}],[{name:'__proto__',type:'boolean'}],[{name:'e',type:'enum',values:['a','a']}],Array.from({length:129},(_,i)=>({name:`x${i}`,type:'uint',width:1}))]) assert.throws(()=>p.compileSchema(definition))
assert.equal(hex({x:9},[{name:'x',type:'fixed',min:0,max:1,precision:0.1,clamp:true}]),'a0')
assert.equal(hex({x:0.3},[{name:'x',type:'fixed',min:0,max:0.3,precision:0.1}]),'c0')
const floats=[{name:'flag',type:'boolean'},{name:'half',type:'float16'},{name:'full',type:'float32'}]
assert.equal(hex({flag:true,half:1.5,full:23.5},floats),'9f0020de000000')
assert.equal(p.float16Code(1+2**-11),0x3c00)
assert.equal(p.float16Code(1+3*2**-11),0x3c02)
assert.equal(p.float16Code(2**-24),1)
assert.equal(p.float16Code(2**-25),0)
assert.equal(p.float16Code(65504),0x7bff)
assert.throws(()=>p.float16Code(65520),/range/)
assert.throws(()=>p.float16Value(0x7c00),/nonfinite/)
assert.throws(()=>p.encodePayload({flag:true,half:NaN,full:0},floats),/finite/)
assert.throws(()=>p.encodePayload({flag:true,half:0,full:1e40},floats),/range/)
const cppSchema=[...environmental,...ints,...floats]
const values={temperature:72.45,humidity:41.85,active:true,u:4294967295,i:-2147483648,bits:31,mode:'standby',flag:true,half:1.5,full:23.5}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'struct-packed-'))
try{
 fs.writeFileSync(path.join(temp,'packet.h'),p.generateCHeader(cppSchema,{slot:3}))
 const init=cppSchema.map(f=>`.f_${f.name}=${f.type==='enum'?2:f.type==='boolean'?(values[f.name]?1:0):values[f.name]}`).join(',')
 fs.writeFileSync(path.join(temp,'test.c'),`#include <stdio.h>\n#include "packet.h"\nint main(void){ StructPacket p={${init}}; uint8_t out[STRUCT_PACKET_SIZE]; if(!struct_pack_packet(out,sizeof(out),&p))return 1;for(size_t i=0;i<sizeof(out);i++)printf("%02x",out[i]);p.f_temperature=126;if(struct_pack_packet(out,sizeof(out),&p))return 2;return 0;}\n`)
 const candidates=[process.env.STRUCT_C_COMPILER,'gcc','clang','C:/msys64/ucrt64/bin/gcc.exe','C:/msys64/mingw64/bin/gcc.exe','C:/Program Files/LLVM/bin/clang.exe'].filter(Boolean)
 const compiler=candidates.find(c=>cp.spawnSync(c,['--version'],{encoding:'utf8'}).status===0)
 if(compiler){const executable=path.join(temp,process.platform==='win32'?'packed.exe':'packed');const build=cp.spawnSync(compiler,['-std=c99','-Wall','-Wextra',path.join(temp,'test.c'),'-lm','-o',executable],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);const run=cp.spawnSync(executable,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,hex(values,cppSchema));console.log('Generated C/Node packed parity passed')}
 else if(process.env.STRUCT_ZIG_COMPILER){
  const executable=path.join(temp,'packed.wasm');const build=cp.spawnSync(process.env.STRUCT_ZIG_COMPILER,['cc','-target','wasm32-wasi','-O2','-std=c99',path.join(temp,'test.c'),'-lm','-o',executable],{encoding:'utf8'});assert.equal(build.status,0,build.stderr)
  const run=cp.spawnSync(process.execPath,['-e',`const {WASI}=require('node:wasi');const fs=require('node:fs');const wasi=new WASI({version:'preview1',returnOnExit:true});const instance=new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(process.argv[1])),wasi.getImportObject());process.exitCode=wasi.start(instance)||0;`,executable],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,hex(values,cppSchema));console.log('Generated C WASI/Node packed parity passed')
 }else console.log('Generated C parity compiler not available; set STRUCT_C_COMPILER or STRUCT_ZIG_COMPILER to execute host parity')
}finally{fs.rmSync(temp,{recursive:true,force:true})}
console.log('Packed schema boundaries, fixed rounding, floats, padding and 3-byte example passed')
