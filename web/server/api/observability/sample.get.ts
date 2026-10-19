import { uuid } from '../../utils/integrations'
import { isDeepStrictEqual } from 'node:util'
import { observabilityContext } from '../../utils/observability'
import { calculate } from '../../protocol-lab/engine'
import { loadResearch } from '../../protocol-lab/data'
import { defaultSettings, makeField } from '#shared/protocol-lab/config'
import type { LabField } from '#shared/protocol-lab/types'
import * as packed from '../../../../protocol/schema/bitpacked.cjs'
import * as legacy from '../../../../tcp-server/parser.js'
import * as wire from '../../../../sdk/js/secure-v2.cjs'
export default defineEventHandler(async (event) => {
  const q = getQuery(event),
    org = uuid(q.orgId),
    device = uuid(q.device),
    { service } = await observabilityContext(event, org)
  const d = await service
    .from('devices')
    .select('id')
    .eq('id', device)
    .eq('organization_id', org)
    .maybeSingle()
  if (d.error || !d.data)
    throw createError({ statusCode: 403, message: 'Device access denied.' })
  const t = await service
    .from('telemetry')
    .select('id,timestamp,parsed_json,secure_v2_schema_slot')
    .eq('device_id', device)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (t.error || !t.data || t.data.secure_v2_schema_slot === null)
    return {
      available: false,
      reason:
        'A retained Secure V2 reading and its immutable schema are required.',
    }
  const s = await service
    .from('secure_v2_schema_slots')
    .select('slot,encoding,schema_definition')
    .eq('device_id', device)
    .eq('slot', t.data.secure_v2_schema_slot)
    .single()
  if (s.error || !s.data)
    return { available: false, reason: 'Immutable schema unavailable.' }
  const definition = s.data.schema_definition as any[],
    codec = s.data.encoding === 'bitpacked-v1' ? packed : legacy
  const recordBytes = codec.schemaByteLength(definition),
    maximum = Math.min(
      255,
      Math.floor(
        (wire.DEFAULT_MAX_FRAME_BYTES - wire.FRAME_OVERHEAD - 1) / recordBytes,
      ),
    )
  const batch = Math.min(10, maximum)
  const insights: Record<string, unknown>[] = [
    {
      kind: 'batch',
      recordBytes,
      batch,
      applicationPerReading:
        batch > 0
          ? (batch * recordBytes + wire.FRAME_OVERHEAD + 1) / batch
          : null,
      singleApplicationBytes: recordBytes + wire.FRAME_OVERHEAD,
      evidence:
        'Specification-calculated from actual immutable schema; hypothetical alternative, not observed savings.',
      tradeoffs:
        'Firmware update required; buffering, latency, RAM and larger loss impact. SDK frame bound applied; no automatic device change.',
    },
  ]
  if (s.data.encoding === 'legacy-le-v1') {
    try {
      const candidate = definition.map((f): packed.PackedField => {
        const integer = /^(u?int)(8|16|32|64)$/.exec(f.type)
        if (integer)
          return {
            name: f.name,
            type: integer[1] === 'uint' ? 'uint' : 'int',
            width: Number(integer[2]),
          }
        if (['boolean', 'float32', 'float64'].includes(f.type))
          return { name: f.name, type: f.type }
        throw Error('No verified lossless field mapping')
      })
      const values = Object.fromEntries(
        Object.entries(t.data.parsed_json).map(([k, v]: [string, any]) => [
          k,
          v && typeof v === 'object' && '$integer' in v
            ? BigInt(v.$integer)
            : v,
        ]),
      )
      const encoded = packed.encodePayload(values, candidate),
        decoded = packed.decodePayload(encoded, candidate)
      if (!isDeepStrictEqual(decoded, values))
        throw Error('Lossless sample verification failed')
      insights.push({
        kind: 'schema',
        originalPayloadBytes: recordBytes,
        candidatePayloadBytes: encoded.length,
        savings: recordBytes - encoded.length,
        schema: candidate,
        evidence:
          'Calculated with the real bitpacked-v1 encoder and verified against this decoded sample. Full integer/float widths retained; only field packing changes.',
        tradeoffs:
          'Publish an unused immutable slot, regenerate the SDK and update firmware. No inferred numeric ranges or lossy rounding; no automatic deployment.',
      })
    } catch {
      /* Complex mappings stay unavailable rather than implying a verified conversion. */
    }
  }
  try {
    const fields: LabField[] = definition.map((f) => {
      const val = t.data.parsed_json[f.name],
        match = /^(u?int)(8|16|32|64)$/.exec(f.type)
      let type: LabField['type'] =
        f.type === 'boolean'
          ? 'bool'
          : match
            ? match[1] === 'uint'
              ? 'uint'
              : 'int'
            : f.type
      if (
        ![
          'bool',
          'uint',
          'int',
          'float16',
          'float32',
          'float64',
          'fixed',
          'enum',
          'bitset',
          'string',
          'bytes',
          'timestamp',
        ].includes(type)
      )
        throw Error(
          `The fleet sample adapter does not support ${f.type}; inspect it in Protocol Lab.`,
        )
      const value =
        val && typeof val === 'object' && '$integer' in val
          ? val.$integer
          : val && typeof val === 'object' && '$bytes' in val
            ? val.$bytes
            : String(val)
      return {
        ...makeField(f.name, type, value),
        width: match ? Number(match[2]) : (f.width ?? 32),
        min: f.min,
        max: f.max,
        step: f.precision,
        labels: f.values,
        maxBytes: f.maxBytes,
      }
    })
    const config = {
      fields,
      settings: {
        ...structuredClone(defaultSettings),
        precision:
          s.data.encoding === 'bitpacked-v1'
            ? ('optimized' as const)
            : ('original' as const),
        traffic: 'uplink' as const,
      },
    }
    const comparison = calculate(config, await loadResearch(), false)
    return {
      available: true,
      sample: {
        id: t.data.id,
        at: t.data.timestamp,
        scope:
          'One latest retained reading; not a fleet distribution or traffic forecast.',
        schema: s.data,
      },
      insights,
      comparison,
    }
  } catch (e) {
    return {
      available: true,
      sample: {
        id: t.data.id,
        at: t.data.timestamp,
        scope: 'One retained reading',
      },
      insights,
      comparison: null,
      reason: e instanceof Error ? e.message : 'Sample comparison unavailable.',
    }
  }
})
