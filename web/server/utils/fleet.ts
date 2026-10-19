import type { H3Event } from 'h3'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from '#supabase/server'
import { requireOrgWriter } from './auth'
import { uuid } from './integrations'
import {
  deviceRow,
  quantityRows,
  csvRows,
  labels,
  OPERATIONS,
} from '#shared/fleet'
import { resolveCapacityPlan } from './deviceCapacity'
export async function fleetContext(event: H3Event, org: string, write = false) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (process.env.STRUCT_FLEET_ENABLED !== 'true')
    throw createError({
      statusCode: 503,
      message:
        'Fleet management requires migration 037 and explicit activation.',
    })
  const client = await serverSupabaseClient(event)
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user)
    throw createError({ statusCode: 401, message: 'Not authenticated' })
  if (write) await requireOrgWriter(event, org, 'devices.update')
  else {
    const { data, error } = await client
      .from('organization_members')
      .select('role')
      .eq('organization_id', org)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data)
      throw createError({ statusCode: 403, message: 'Workspace access denied' })
  }
  const service = await serverSupabaseServiceRole(event)
  // Explicit API activation check prevents stale UI flags from bypassing staged rollout.
  const { data, error } = await (service as any)
    .from('fleet_settings')
    .select('enabled')
    .eq('id', true)
    .single()
  if (error || !data?.enabled)
    throw createError({
      statusCode: 503,
      message: 'Fleet database is not activated.',
    })
  return { service: service as any, user }
}
export async function fleetBody(event: H3Event) {
  if (
    getHeader(event, 'sec-fetch-site') === 'cross-site' ||
    !getHeader(event, 'content-type')?.startsWith('application/json')
  )
    throw createError({
      statusCode: 400,
      message: 'Same-site JSON request required.',
    })
  let size = 0
  const parts: Buffer[] = []
  for await (const part of event.node.req) {
    const b = Buffer.from(part)
    size += b.length
    if (size > 8 * 1024 * 1024)
      throw createError({ statusCode: 413, message: 'Request exceeds 8 MiB.' })
    parts.push(b)
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'))
    if (!value || Array.isArray(value) || typeof value !== 'object')
      throw new Error()
    return value as Record<string, any>
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid JSON.' })
  }
}
export function fleetError(error: { message: string } | null) {
  if (!error) return
  const code =
    error.message.match(
      /FLEET_FORBIDDEN|FLEET_DISABLED|FREE_DEVICE_LIMIT_EXCEEDED|[A-Z_]*VERSION_CONFLICT|PREVIEW_EXPIRED|[A-Z_]*LIMIT[A-Z_0-9]*|PROVISIONING_ALREADY_EXPORTED_OR_UNAUTHORIZED|CREDENTIAL_ALREADY_USED|INVALID_[A-Z_]+|EMPTY_SELECTION/,
    )?.[0] || 'FLEET_ACTION_FAILED'
  throw createError({
    statusCode:
      code === 'FLEET_FORBIDDEN'
        ? 403
        : code === 'FREE_DEVICE_LIMIT_EXCEEDED'
          ? 402
          : code.includes('CONFLICT')
            ? 409
            : 400,
    message: code.replaceAll('_', ' ').toLowerCase(),
    data: {
      code,
      actionUrl:
        code === 'FREE_DEVICE_LIMIT_EXCEEDED'
          ? '/dashboard/settings?tab=billing'
          : undefined,
    },
  })
}
export function fleetFilter(raw: unknown) {
  const f =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const result: Record<string, unknown> = {}
  if (f.search) {
    if (typeof f.search !== 'string' || f.search.length > 128)
      throw new Error('Search exceeds 128 characters')
    result.search = f.search
  }
  if (f.status) {
    if (
      ![
        'active',
        'inactive',
        'never',
        'disabled',
        'revoked',
        'deleted',
      ].includes(String(f.status))
    )
      throw new Error('Invalid status')
    result.status = f.status
  }
  if (f.sort) {
    if (!['created', 'name', 'seen'].includes(String(f.sort)))
      throw new Error('Invalid sorting')
    result.sort = f.sort
  }
  if (f.group) result.group = uuid(f.group)
  if (f.labels) result.labels = labels(f.labels as string[])
  if (f.schemaDevice) {
    result.schemaDevice = uuid(f.schemaDevice)
    if (
      !Number.isInteger(f.schemaSlot) ||
      Number(f.schemaSlot) < 0 ||
      Number(f.schemaSlot) > 15
    )
      throw new Error('Invalid schema slot')
    result.schemaSlot = f.schemaSlot
  }
  for (const key of [
    'createdAfter',
    'createdBefore',
    'seenAfter',
    'seenBefore',
  ])
    if (f[key]) {
      const date = Date.parse(String(f[key]))
      if (!Number.isFinite(date)) throw new Error('Invalid date filter')
      result[key] = new Date(date).toISOString()
    }
  return result
}
export async function previewFleet(event: H3Event) {
  const body = await fleetBody(event),
    org = uuid(body.orgId),
    { service, user } = await fleetContext(event, org, true)
  try {
    if (!OPERATIONS.includes(body.operation))
      throw new Error('Unsupported operation.')
    const operation = body.operation,
      options: Record<string, unknown> = {}
    const input = body.options || {}
    if (input.groups) {
      if (!Array.isArray(input.groups) || input.groups.length > 20)
        throw new Error('Choose at most 20 groups')
      options.groups = [...new Set(input.groups.map(uuid))]
    }
    if (input.labels) options.labels = labels(input.labels)
    if (input.sourceDevice) {
      options.sourceDevice = uuid(input.sourceDevice)
      if (
        !Number.isInteger(input.sourceSlot) ||
        input.sourceSlot < 0 ||
        input.sourceSlot > 15
      )
        throw new Error('Choose a valid source slot')
      options.sourceSlot = input.sourceSlot
    }
    if (operation === 'metadata') {
      const row = deviceRow({
        name: 'metadata',
        description: input.description,
        metadata: input.metadata,
      })
      if (input.description !== undefined) options.description = row.description
      if (input.metadata !== undefined) options.metadata = row.metadata
      if (!Object.keys(options).length)
        throw new Error('Choose metadata to update')
    }
    if (
      ['groups_add', 'groups_remove'].includes(operation) &&
      !(options.groups as string[])?.length
    )
      throw new Error('Choose groups')
    if (
      ['labels_add', 'labels_remove'].includes(operation) &&
      !(options.labels as string[])?.length
    )
      throw new Error('Choose tags')
    let rows: unknown[] = []
    if (operation === 'create') {
      if (!['reject', 'skip', 'metadata'].includes(body.duplicates || 'reject'))
        throw new Error('Invalid duplicate policy')
      options.duplicates = body.duplicates || 'reject'
      if (body.quantity !== undefined)
        rows = quantityRows(
          body.prefix || '',
          body.quantity,
          body.start ?? 1,
          body.digits ?? 3,
        )
      else if (body.csv !== undefined) {
        if (typeof body.csv !== 'string') throw new Error('Invalid CSV')
        const parsed = csvRows(body.csv, body.mapping || {})
        const invalid = parsed.filter((r) => r.error)
        if (invalid.length)
          throw new Error(
            `${invalid.length} invalid rows. First: row ${invalid[0]!.row}: ${invalid[0]!.error}`,
          )
        rows = parsed.map((r) => r.value!)
      } else {
        if (!Array.isArray(body.rows)) throw new Error('Device rows required')
        rows = body.rows.map(deviceRow)
      }
      if (!rows.length || rows.length > 10000)
        throw new Error('Choose 1–10,000 devices')
      const groupLookup = await service
        .from('device_groups')
        .select('id,name')
        .eq('organization_id', org)
        .limit(200)
      fleetError(groupLookup.error)
      rows = rows.map((r: any) => {
        const g = r.group
          ? groupLookup.data.find(
              (g: any) => g.name.toLowerCase() === r.group.toLowerCase(),
            )
          : null
        if (r.group && !g) throw new Error('Unknown group: ' + r.group)
        const { group, tags, ...safe } = r
        return {
          ...safe,
          ...(g ? { groups: [g.id] } : {}),
          ...(tags ? { labels: labels(tags) } : {}),
        }
      })
      const collisions: string[] = []
      const seen = new Set<string>()
      for (const r of rows as ReturnType<typeof deviceRow>[])
        for (const key of ['external_id', 'serial_number'] as const)
          if (r[key]) {
            const identity = `${key}:${r[key]}`
            if (seen.has(identity)) collisions.push(identity)
            seen.add(identity)
          }
      if (collisions.length && options.duplicates === 'reject')
        throw new Error(`Duplicate rows: ${collisions.slice(0, 3).join(', ')}`)
      // Upper-bound preview, corrected against current identity collisions by the item transaction.
      const estimate = await service.rpc('fleet_creation_estimate', {
        p_org: org,
        p_actor: user.id,
        p_rows: rows,
      })
      fleetError(estimate.error)
      const plan = await resolveCapacityPlan(
        service,
        org,
        estimate.data.createsUpperBound,
      )
      options.billingPreview = {
        current: plan.currentCount,
        projected: plan.projectedCount,
        estimatedTrueUpCents: plan.estimatedTrueUpCents,
        currency: plan.currency,
      }
    } else if (!body.filter) {
      if (
        !Array.isArray(body.rows) ||
        !body.rows.length ||
        body.rows.length > 10000
      )
        throw new Error('Select 1–10,000 devices')
      const seen = new Set<string>()
      rows = body.rows.map((r: any) => {
        const id = uuid(r.id)
        if (seen.has(id) || !Number.isInteger(r.version) || r.version < 1)
          throw new Error('Duplicate device or invalid version')
        seen.add(id)
        return { id, version: r.version }
      })
    }
    const { data, error } = await service.rpc('fleet_preview', {
      p_org: org,
      p_actor: user.id,
      p_request: uuid(body.requestId),
      p_operation: operation,
      p_options: options,
      p_rows: rows,
      p_filter: body.filter ? fleetFilter(body.filter) : null,
    })
    fleetError(error)
    return { jobId: data }
  } catch (e: any) {
    if (e.statusCode) throw e
    throw createError({
      statusCode: 400,
      message: e.message || 'Invalid fleet request.',
    })
  }
}
