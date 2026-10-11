import { it, expect } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { defaults, presetFields } from '../../shared/protocol-lab/config'
import { calculate } from './engine'
import type { ResearchIndex, LabMetadata } from '../../shared/protocol-lab/types'
const data = JSON.parse(gunzipSync(readFileSync(new URL('../assets/protocol-lab/index.json.gz', import.meta.url))).toString()) as ResearchIndex
const metadata = JSON.parse(readFileSync(new URL('../../public/protocol-lab/metadata.json', import.meta.url), 'utf8')) as LabMetadata
it('records every preset across security, delivery, precision, batching and IP axes', () => {
  const records: unknown[] = []
  for (const preset of metadata.presets) for (const security of [true, false])
    for (const delivery of ['confirmed', 'unconfirmed'] as const)
      for (const precision of ['original', 'optimized'] as const)
        for (const batch of [1, 10]) for (const network of ['IPv4', 'IPv6'] as const) {
          const c = defaults(); c.fields = presetFields(preset)
          Object.assign(c.settings, { security, delivery, precision, batch, network })
          const response = calculate(c, data, false)
          for (const r of response.results) {
            const value = r.metrics.effective?.value ?? null
            expect(value === null || Number.isFinite(value)).toBe(true)
            if(!process.env.LAB_COVERAGE_ALLOW_MISSING){expect(value,`${preset.id}/${r.id}/${security}/${delivery}/${precision}/${batch}/${network}: ${r.reason}`).not.toBeNull();expect(r.reduction).not.toBeNull()}
            records.push({ preset: preset.id, protocol: r.id, security, delivery, precision, batch, network,
              boundary: c.settings.boundary, status: r.status, value, reduction: r.reduction,
              coverage_category: ['protobuf','json','cbor'].includes(r.id) || r.metrics.applicationUp?.evidence === 'estimated' ? 'supported_modeled' : 'supported_specification_calculated',
              evidence: r.metrics.effective?.evidence, reason: r.reason ?? r.metrics.selected?.note,
              comparison: r.notComparable, dimensions:r.comparison })
          }
        }
  if (process.env.LAB_COVERAGE_OUTPUT) {
    const dir = new URL('../../../benchmarks/multi-protocol/extensions/lab-v2/', import.meta.url)
    mkdirSync(dir, { recursive: true })
    writeFileSync(new URL(process.env.LAB_COVERAGE_OUTPUT, dir), JSON.stringify({ timestamp: new Date().toISOString(), records }, null, 2))
  }
  expect(records.length).toBe(1920)
}, 120000)

it('records advanced batch, connection, serializer and MTU limits without hiding missing cases',()=>{
  const records: unknown[]=[]
  for(const preset of metadata.presets)for(const batch of [2,5,25,50,100]){
    const c=defaults();c.fields=presetFields(preset);c.settings.batch=batch
    for(const r of calculate(c,data,false).results)records.push({preset:preset.id,axis:'batch',batch,protocol:r.id,reduction:r.reduction,status:r.status,evidence:r.metrics.effective?.evidence,value:r.metrics.effective?.value??null,reason:r.reason??r.metrics.selected?.note})
  }
  for(const preset of metadata.presets)for(const connection of ['fresh','periodic'] as const)for(const includeSetup of [true,false]){
    const c=defaults();c.fields=presetFields(preset);Object.assign(c.settings,{connection,includeSetup,messagesPerConnection:10})
    for(const r of calculate(c,data,false).results)records.push({preset:preset.id,axis:'connection',connection,includeSetup,protocol:r.id,reduction:r.reduction,status:r.status,evidence:r.metrics.effective?.evidence,value:r.metrics.effective?.value??null,reason:r.reason??r.metrics.selected?.note})
  }
  const variants = [
    {qos:2,mqttVersion:4,tls:'TLSv1.2',network:'IPv6'},
    {qos:1,mqttVersion:5,mqttProperties:true,topic:'building/floor/device/telemetry'},
    {security:false,qos:0,mqttVersion:4},
    {coapEncoding:'cbor-canonical',oscore:'AES-CCM-16-64-128',coapToken:0,coapPath:'/sensors/temperature'},
    {coapEncoding:'json-compact',coapToken:8,lwm2mFormat:'SENML_JSON'},
    {jsonTransport:'https',compression:'off'},
    {jsonTransport:'https',compression:'gzip'},
    {structGeneration:'v1',security:false,precision:'original'},
    {coapSecurity:'dtls-ccm8',coapEncoding:'protobuf',precision:'original'},
    {coapSecurity:'dtls-ccm16',coapEncoding:'cbor-canonical',precision:'original'},
  ]
  for(const preset of metadata.presets)for(const [variant,overrides] of variants.entries()){
    const c=defaults();c.fields=presetFields(preset);Object.assign(c.settings,overrides)
    for(const r of calculate(c,data,false).results)records.push({preset:preset.id,axis:'protocol_options',variant,settings:overrides,protocol:r.id,reduction:r.reduction,status:r.status,evidence:r.metrics.effective?.evidence,value:r.metrics.effective?.value??null,reason:r.reason??r.metrics.selected?.note})
  }
  if(process.env.LAB_COVERAGE_OUTPUT)writeFileSync(new URL('../../../benchmarks/multi-protocol/extensions/lab-v2/coverage-advanced.json',import.meta.url),JSON.stringify({records},null,2))
  expect(records.length).toBe(1140)
},120000)
