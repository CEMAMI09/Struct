import { test, expect, type Page } from '@playwright/test'
import { randomUUID, randomBytes, generateKeyPairSync, sign } from 'node:crypto'
import core from '../../../protocol/management/core.cjs'
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', (e) => list.push(e.message))
})
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]))
async function login(
  page: Page,
  path: string,
  email = 'local@example.invalid',
) {
  await page.goto('/login?redirect=' + encodeURIComponent(path))
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(path + '$'))
}
async function device(page: Page, f: any, action: string, data: any = {}) {
  const bytes = Buffer.from(JSON.stringify({ action, data })),
    hash = core.digest(bytes),
    r = await page.request.post('/api/device-management/challenge', {
      data: { wireDeviceId: f.management.wireDeviceId, bodyHash: hash },
    })
  expect(r.status(), await r.text()).toBe(200)
  const c = await r.json()
  const response = await page.request.post('/api/device-management/message', {
    data: {
      wireDeviceId: f.management.wireDeviceId,
      challengeId: c.id,
      nonce: c.nonce,
      payload: bytes.toString('base64'),
      mac: core.requestMac(
        core.managementKey(f.management.rootSecret, f.management.wireDeviceId),
        f.management.wireDeviceId,
        c.id,
        c.nonce,
        hash,
      ),
    },
  })
  expect(response.status(), await response.text()).toBe(200)
  return response.json()
}
async function fit(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true)
}
test('real preview, confirmation, device acknowledgment, desired/reported state and timeline', async ({
  page,
}, info) => {
  await login(
    page,
    '/dashboard/device-operations',
    'owner-' + info.project.name + '@example.invalid',
  )
  const f = await (
    await page.request.get('http://127.0.0.1:3125/__fixture')
  ).json()
  await expect(
    page.locator('.managed-page').getByRole('heading', { name: 'Device operations', exact: true }),
  ).toBeVisible()
  await page
    .getByLabel('Operation', { exact: true })
    .selectOption('configuration')
  await page
    .getByLabel('Reporting interval (seconds)')
    .fill(
      String(
        info.project.name === 'desktop'
          ? 300
          : info.project.name === 'tablet'
            ? 301
            : 302,
      ),
    )
  await page
    .getByLabel('Device UUIDs (comma or newline separated)')
    .fill(f.device)
  await page.getByText('Rollout safety settings', { exact: true }).click()
  await page.getByLabel('Cumulative wave percentages').fill('100')
  await page.getByLabel('Observation window (seconds)').fill('0')
  await page
    .getByRole('button', { name: 'Create preview', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('Draft saved')
  await expect(
    page.getByRole('heading', { name: 'Target preview / history' }),
  ).toBeVisible()
  const overview = await (
    await page.request.get('/api/device-operations', {
      params: { orgId: f.org },
    })
  ).json()
  const rollout = overview.rollouts.find(
    (r: any) => r.state === 'draft' && r.kind === 'configuration',
  )
  expect(rollout.eligible).toBe(1)
  page.once('dialog', (d) => d.accept())
  await page
    .getByRole('button', { name: 'Confirm rollout', exact: true })
    .first()
    .click()
  let op: any
  await expect
    .poll(async () => {
      const r = await device(page, f, 'poll')
      op = r.operation
      return op?.kind
    })
    .toBe('configuration')
  expect(op.state).toBe('assigned')
  await device(page, f, 'report', {
    id: op.id,
    generation: op.generation,
    stage: 'applied',
    configuration: op.configuration,
  })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(
    page.getByText('configuration · applied', { exact: true }).first(),
  ).toBeVisible()
  await page.getByText('Desired and reported state', { exact: true }).click()
  await expect(
    page.getByText('Reported configuration', { exact: true }),
  ).toBeVisible()
  await page.getByText('Recorded timeline', { exact: true }).first().click()
  await expect(
    page.getByText(/authenticated_device_claim/).first(),
  ).toBeVisible()
  await fit(page)
  await page.screenshot({
    path: `../work/management/${info.project.name}-operations.png`,
    fullPage: true,
  })
})
test('public-key registration, signed binary upload, approval and immutable download contract', async ({
  page,
}, info) => {
  await login(
    page,
    '/dashboard/firmware',
    'owner-' + info.project.name + '@example.invalid',
  )
  const f = await (
      await page.request.get('http://127.0.0.1:3125/__fixture')
    ).json(),
    keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
    pem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  await page
    .getByLabel('Key name', { exact: true })
    .fill('Browser ' + info.project.name)
  await page.getByLabel('Public P-256 PEM').fill(pem)
  await page
    .getByRole('button', { name: 'Register public key', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'Public signing key registered',
  )
  let overview = await (
    await page.request.get('/api/device-operations', {
      params: { orgId: f.org },
    })
  ).json()
  const key = overview.keys.find(
    (k: any) => k.fingerprint === core.fingerprint(pem),
  )
  expect(key).toBeTruthy()
  const image = randomBytes(1024)
  image[0] = 0xe9
  image[1] = 1
  image.writeUInt16LE(0, 12)
  image.writeUInt32LE(0xabcd5432, 32)
  const manifest = {
      format: 1,
      artifactId: randomUUID(),
      organizationId: f.org,
      keyId: key.id,
      platform: 'esp32',
      identityMode: 'persistent-nvs-v1',
      hardwareModel: 'browser-' + info.project.name,
      hardwareRevision: 'A',
      version: '1.0.' + Date.now(),
      securityVersion: 1,
      minAgentVersion: 1,
      minimumBootloaderVersion: 1,
      size: image.length,
      sha256: core.digest(image),
    },
    signature = sign(
      'sha256',
      core.canonical(manifest),
      keys.privateKey,
    ).toString('base64')
  await page.getByLabel('Signed release JSON', { exact: true }).setInputFiles({
    name: 'signed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ manifest, signature })),
  })
  await page
    .getByLabel('Compiled firmware binary (up to 4 MiB)', { exact: true })
    .setInputFiles({
      name: 'firmware.bin',
      mimeType: 'application/octet-stream',
      buffer: image,
    })
  await page
    .getByRole('button', { name: 'Verify and upload', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('Artifact verified')
  page.once('dialog', (d) => d.accept())
  await page
    .getByRole('button', { name: 'Approve release', exact: true })
    .click()
  await expect
    .poll(async () => {
      overview = await (
        await page.request.get('/api/device-operations', {
          params: { orgId: f.org },
        })
      ).json()
      return overview.artifacts.find((a: any) => a.id === manifest.artifactId)
        ?.state
    })
    .toBe('approved')
  await device(page, f, 'capabilities', {
    platform: 'esp32',

    hardwareModel: manifest.hardwareModel,
    hardwareRevision: 'A',
    firmwareVersion: '0.1.0',
    agentVersion: 1,
    bootloaderVersion: 1,
    partitionBytes: 1900544,
    securityVersion: 0,
    keyFingerprints: [key.fingerprint],
    rollback: true,
    ota: true,
    configuration: true,
  })
  const enrollment = await page.request.post('/api/device-operations/action', {
    data: {
      orgId: f.org,
      action: 'enable_device',
      data: { id: f.device, enabled: true },
    },
  })
  expect(enrollment.status()).toBe(200)
  const preview = await page.request.post('/api/device-operations/preview', {
    data: {
      orgId: f.org,
      requestId: randomUUID(),
      definition: {
        kind: 'firmware',
        artifactId: manifest.artifactId,
        selection: { ids: [f.device] },
        wavePercentages: [100],
        observationSeconds: 0,
        manualAdvance: false,
      },
    },
  })
  expect(preview.status()).toBe(200)
  const rollout = (await preview.json()).id
  const confirmed = await page.request.post('/api/device-operations/action', {
    data: {
      orgId: f.org,
      action: 'confirm',
      data: { id: rollout, kind: 'firmware', confirm: true },
    },
  })
  expect(confirmed.status()).toBe(200)
  let operation: any
  await expect
    .poll(async () => {
      operation = (await device(page, f, 'poll')).operation
      return operation?.kind
    })
    .toBe('firmware')
  const binary = await page.request.get(operation.downloadPath, {
    headers: { Authorization: 'Bearer ' + operation.downloadToken },
  })
  expect(binary.status()).toBe(200)
  expect(core.digest(await binary.body())).toBe(manifest.sha256)
  const partial = await page.request.get(operation.downloadPath, {
    headers: {
      Authorization: 'Bearer ' + operation.downloadToken,
      Range: 'bytes=100-199',
    },
  })
  expect(partial.status()).toBe(206)
  expect((await partial.body()).length).toBe(100)
  for (const stage of [
    'downloading',
    'verified',
    'installing',
    'awaiting_reboot',
    'booting',
  ])
    await device(page, f, 'report', {
      id: operation.id,
      generation: operation.generation,
      stage,
    })
  await device(page, f, 'report', {
    id: operation.id,
    generation: operation.generation,
    stage: 'healthy',
    sha256: manifest.sha256,
    securityVersion: manifest.securityVersion,
    healthValidated: true,
  })
  const factoryBytes = Buffer.concat([image, Buffer.from(core.FACTORY_MARKER)]),
    factoryManifest = {
      ...manifest,
      artifactId: randomUUID(),
      version: 'factory-' + Date.now(),
      size: factoryBytes.length,
      sha256: core.digest(factoryBytes),
    },
    factorySignature = sign(
      'sha256',
      core.canonical(factoryManifest),
      keys.privateKey,
    ).toString('base64')
  const draft = await page.request.post('/api/device-operations/action', {
    data: {
      orgId: f.org,
      action: 'artifact',
      data: { manifest: factoryManifest, signature: factorySignature },
    },
  })
  expect(draft.status()).toBe(200)
  const forbidden = await page.request.put(
    '/api/device-operations/artifacts/' + factoryManifest.artifactId,
    {
      params: { orgId: f.org },
      headers: { 'Content-Type': 'application/octet-stream' },
      data: factoryBytes,
    },
  )
  expect(forbidden.status()).toBe(400)
  const forged = await page.request.post('/api/device-operations/action', {
    data: {
      orgId: f.org,
      action: 'uploaded',
      data: { id: manifest.artifactId },
    },
  })
  expect(forged.status()).toBe(400)
  const download = await page.request.get(
    '/api/device-management/download/' + randomUUID(),
  )
  expect(download.status()).toBe(401)
  await fit(page)
  await page.screenshot({
    path: `../work/management/${info.project.name}-firmware.png`,
    fullPage: true,
  })
  await page.goto('/docs/device-operations')
  await expect(
    page.getByRole('heading', {
      name: 'Secure firmware and remote configuration',
      exact: true,
    }),
  ).toBeVisible()
  await fit(page)
})
test('viewer cannot deploy or register keys and foreign workspace is denied', async ({
  page,
}) => {
  await login(page, '/dashboard/device-operations', 'viewer@example.invalid')
  await expect(
    page.getByText(
      'Your role can inspect operations. Ask an administrator to create a rollout.',
    ),
  ).toBeVisible()
  expect(
    await page
      .getByRole('button', { name: 'Create preview', exact: true })
      .count(),
  ).toBe(0)
  const f = await (
    await page.request.get('http://127.0.0.1:3125/__fixture')
  ).json()
  const denied = await page.request.post('/api/device-operations/preview', {
    data: {
      orgId: f.org,
      requestId: randomUUID(),
      definition: {
        kind: 'configuration',
        selection: { ids: [f.device] },
        configuration: {
          reportIntervalSeconds: 60,
          sampleIntervalSeconds: 60,
          diagnosticLevel: 'error',
        },
      },
    },
  })
  expect(denied.status()).toBe(403)
  const foreign = await page.request.get('/api/device-operations', {
    params: { orgId: f.otherOrg },
  })
  expect(foreign.status()).toBe(403)
  await fit(page)
})
