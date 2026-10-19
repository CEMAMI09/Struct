import { uuid } from '../../utils/integrations'
import {
  fleetBody,
  fleetContext,
  fleetFilter,
  fleetError,
} from '../../utils/fleet'
import { csvExport } from '#shared/fleet'
export default defineEventHandler(async (event) => {
  const b = await fleetBody(event),
    org = uuid(b.orgId),
    { service, user } = await fleetContext(event, org)
  const audit = await service.rpc('fleet_export_begin', {
    p_org: org,
    p_actor: user.id,
    p_action: 'metadata_export',
  })
  fleetError(audit.error)
  let rows: unknown[][] = []
  if (b.jobId) {
    const id = uuid(b.jobId),
      { data: job, error } = await service
        .from('fleet_jobs')
        .select('id')
        .eq('id', id)
        .eq('organization_id', org)
        .maybeSingle()
    fleetError(error)
    if (!job) throw createError({ statusCode: 404, message: 'Job not found.' })
    rows = [['row', 'name', 'device_id', 'status', 'error_code']]
    for (let page = 0; page < 100; page++) {
      const { data, error } = await service
        .from('fleet_job_items')
        .select('item_index,input,device_id,status,error_code')
        .eq('job_id', id)
        .order('item_index')
        .range(page * 100, page * 100 + 99)
      fleetError(error)
      rows.push(
        ...data.map((r: any) => [
          r.item_index + 1,
          r.input.name,
          r.device_id,
          r.status,
          r.error_code,
        ]),
      )
      if (data.length < 100) break
    }
  } else {
    const ids =
      b.ids === undefined ? null : Array.isArray(b.ids) ? b.ids.map(uuid) : []
    if (ids && (!ids.length || ids.length > 10000))
      throw createError({
        statusCode: 400,
        message: 'Select 1–10,000 devices.',
      })
    rows = [
      [
        'id',
        'name',
        'external_id',
        'serial_number',
        'status',
        'tags',
        'groups',
        'last_seen',
        'description',
        'metadata',
      ],
    ]
    if (ids) {
      const groupResult = await service.rpc('fleet_group_counts', {
        p_org: org,
        p_actor: user.id,
      })
      fleetError(groupResult.error)
      const groupNames = new Map<string, string>(
        groupResult.data.map((g: any) => [g.id, g.name]),
      )
      for (let at = 0; at < ids.length; at += 100) {
        const { data, error } = await service
          .from('devices')
          .select(
            'id,name,external_id,serial_number,lifecycle,labels,last_seen,description,fleet_metadata',
          )
          .eq('organization_id', org)
          .in('id', ids.slice(at, at + 100))
        fleetError(error)
        if (data.length !== ids.slice(at, at + 100).length)
          throw createError({
            statusCode: 403,
            message: 'Device selection is not authorized.',
          })
        const membership = await service
          .from('device_group_members')
          .select('device_id,group_id')
          .eq('organization_id', org)
          .in('device_id', ids.slice(at, at + 100))
        fleetError(membership.error)
        rows.push(
          ...data.map((d: any) => [
            d.id,
            d.name,
            d.external_id,
            d.serial_number,
            d.lifecycle,
            d.labels.join(','),
            membership.data
              .filter((m: any) => m.device_id === d.id)
              .map((m: any) => groupNames.get(m.group_id) || m.group_id)
              .join(','),
            d.last_seen,
            d.description,
            JSON.stringify(d.fleet_metadata),
          ]),
        )
      }
    } else {
      let f
      try {
        f = fleetFilter(b.filter)
      } catch {
        throw createError({ statusCode: 400, message: 'Invalid filter.' })
      }
      for (let page = 0; page < 100; page++) {
        const { data, error } = await service.rpc('fleet_inventory', {
          p_org: org,
          p_actor: user.id,
          p_filter: f,
          p_page: page,
          p_limit: 100,
        })
        fleetError(error)
        if (data.total > 10000)
          throw createError({
            statusCode: 400,
            message:
              'Export at most 10,000 devices at once. Narrow your filters.',
          })
        rows.push(
          ...data.devices.map((d: any) => [
            d.id,
            d.name,
            d.external_id,
            d.serial_number,
            d.activity,
            d.labels.join(','),
            d.groups.map((g: any) => g.name).join(','),
            d.last_seen,
            d.description,
            JSON.stringify(d.fleet_metadata),
          ]),
        )
        if (data.devices.length < 100) break
      }
    }
  }
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(
    event,
    'Content-Disposition',
    'attachment; filename="struct-metadata.csv"',
  )
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return csvExport(rows)
})
