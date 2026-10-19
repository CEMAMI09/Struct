import {describe,it,expect} from 'vitest'
import {parseCsv,csvRows,csvExport,deviceRow,quantityRows,labels} from './fleet'
describe('fleet CSV and inputs',()=>{
 it('parses BOM, quotes, escaped delimiters and UTF-8',()=>{expect(parseCsv('\uFEFFname,description\r\n"温度","a,b"\r\n"two","a""b"')).toEqual([['name','description'],['温度','a,b'],['two','a"b']])})
 it('accepts embedded newlines without evaluating cells',()=>expect(parseCsv('name,description\n"sensor","a\nb"')[1]).toEqual(['sensor','a\nb']))
 it.each(['name\n"oops','name,name\na,b','name\n"x"bad','name,serial\none','name\na"b'])('rejects malformed CSV: %s',value=>expect(()=>parseCsv(value)).toThrow())
 it('maps columns and reports invalid rows',()=>{const r=csvRows('title,meta\nSensor,"{""lat"":1.5}"\n,{}',{title:'name',meta:'metadata'});expect(r[0]!.value!.metadata).toEqual({lat:1.5});expect(r[1]!.error).toBeTruthy()})
 it('rejects imported secrets and duplicate target fields',()=>{expect(()=>deviceRow({name:'x',rootSecret:'secret'})).toThrow();expect(()=>csvRows('a,b\nx,y',{a:'name',b:'name'})).toThrow()})
 it('bounds files, row counts and column lengths',()=>{expect(()=>parseCsv('x'.repeat(4*1024*1024+1))).toThrow();expect(()=>quantityRows('s',10001)).toThrow();expect(()=>deviceRow({name:'x'.repeat(101)})).toThrow();expect(()=>deviceRow({name:'x',metadata:{x:'a'.repeat(5000)}})).toThrow()})
 it('generates predictable names, never credentials',()=>{expect(quantityRows('sensor-',3,9,3).map(r=>r.name)).toEqual(['sensor-009','sensor-010','sensor-011']);expect(quantityRows('a',1)[0]).not.toHaveProperty('rootSecret')})
 it('normalizes distinct tags',()=>{expect(labels('Outdoor, outdoor, testing')).toEqual(['outdoor','testing']);expect(()=>labels('bad space')).toThrow()})
 it('neutralizes formula injection in every export cell',()=>{const csv=csvExport([['=1+1',' +cmd','@cmd','normal','a"b']]);expect(csv).toContain('"\'=1+1"');expect(csv).toContain('"\' +cmd"');expect(csv).toContain('"\'@cmd"');expect(csv).toContain('"a""b"')})
 it('does not mark physical provisioning from metadata',()=>expect(deviceRow({name:'x'})).toEqual({name:'x',external_id:'',serial_number:'',description:'',metadata:{},lifecycle:'enabled'}))
})
