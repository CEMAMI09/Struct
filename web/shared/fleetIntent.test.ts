import { it, expect } from 'vitest'
import { fleetPreviewIntent, manifestDeviceIds } from './fleet'
it('reuses an ambiguous preview request without storing uploaded data, and changes identity for a new intent', async () => {
  const body = {
    orgId: 'org-a',
    operation: 'create',
    quantity: 10,
    csv: 'name\nprivate label',
  }
  const first = await fleetPreviewIntent(body, null, 1000)
  expect(await fleetPreviewIntent(body, first, 2000)).toEqual(first)
  expect(JSON.stringify(first)).not.toContain('private label')
  expect(
    (await fleetPreviewIntent({ ...body, quantity: 11 }, first, 2000))
      .requestId,
  ).not.toBe(first.requestId)
  expect(
    (await fleetPreviewIntent({ ...body, orgId: 'org-b' }, first, 2000))
      .requestId,
  ).not.toBe(first.requestId)
  expect((await fleetPreviewIntent(body, first, 1801000)).requestId).not.toBe(
    first.requestId,
  )
})
it('exports only newly created credentials from a mixed create/update import', () => {
  const items = [
    { status: 'created', device_id: 'new' },
    { status: 'updated', device_id: 'existing' },
    { status: 'skipped', device_id: 'skip' },
  ]
  expect(manifestDeviceIds('create', items)).toEqual(['new'])
  expect(manifestDeviceIds('reprovision', items)).toEqual(['existing'])
  expect(manifestDeviceIds('metadata', items)).toEqual([])
})
