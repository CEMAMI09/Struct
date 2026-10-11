import { loadResearch } from '../../protocol-lab/data'
export default defineEventHandler(async (event) => {
  const query = getQuery(event),
    data = await loadResearch()
  const text = String(query.q || '')
      .slice(0, 100)
      .toLowerCase(),
    status = String(query.status || ''),
    schema = String(query.schema || ''),
    id = String(query.id || '')
  const offset = Math.floor(Math.max(0, Math.min(data.records.length, Number(query.offset) || 0))),
    limit = Math.floor(Math.max(1, Math.min(50, Number(query.limit) || 25)))
  const rows = data.records.filter((r) => {
    const p = data.profiles[r.profile]!
    return (
      (!id || r.id === id) &&
      (!status || r.test_status === status) &&
      (!schema || r.schema === schema) &&
      (!text ||
        `${p.protocol_stack} ${p.security_configuration} ${p.delivery_mode} ${p.network_type} ${r.schema} ${r.id}`
          .toLowerCase()
          .includes(text))
    )
  })
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return {
    total: rows.length,
    offset,
    limit,
    records: rows
      .slice(offset, offset + limit)
      .map((r) => ({
        ...r,
        configuration: data.profiles[r.profile],
        schemaDefinition: data.schemas.find((s) => s.id === r.schema),
      })),
    datasetVersion: data.version,
  }
})
