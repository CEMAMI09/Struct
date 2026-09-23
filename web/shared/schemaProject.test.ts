import {it,expect} from 'vitest'
import {generateSchemaProject} from './schemaProject'
import {CODE_LANGUAGES} from './schemaCodegen'
it('generates credential-free starters for every saved-schema target',()=>{
 const fields=[{name:'value',type:'uint8' as const}]
 for(const language of CODE_LANGUAGES){const files=generateSchemaProject(fields,7,language,true);expect(files['schema.json']).toContain('value');expect(files['README.md']).toContain('version 7');expect(Object.keys(files).some(n=>n.includes('main')||n.endsWith('.ino'))).toBe(true);expect(JSON.stringify(files)).toContain('STRUCT_ENCRYPTION_KEY')}
 expect(()=>generateSchemaProject(fields,0,'C')).toThrow()
})
