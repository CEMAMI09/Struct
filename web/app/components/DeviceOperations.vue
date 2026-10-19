<template>
  <div class="managed-page">
    <header class="managed-header">
      <div>
        <h1>{{ firmwareOnly ? 'Firmware' : 'Device operations' }}</h1>
        <p>
          Signed releases and controlled configuration changes. Device reports
          confirm outcomes.
        </p>
      </div>
      <NuxtLink class="btn-ghost" to="/docs/device-operations"
        >View guide</NuxtLink
      >
    </header>
    <p v-if="error" role="alert" class="managed-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div class="managed-header">
      <nav aria-label="Device operations">
        <NuxtLink to="/dashboard/firmware">Firmware</NuxtLink
        ><NuxtLink to="/dashboard/device-operations"
          >Rollouts & configuration</NuxtLink
        >
      </nav>
      <button class="btn-ghost" :disabled="busy || loading" @click="refresh">
        {{ loading ? 'Refreshing…' : 'Refresh' }}
      </button>
    </div>
    <form class="managed-grid" @submit.prevent="applyDeviceFilter">
      <label
        >Device UUID filter (optional)<input
          v-model="deviceFilter"
          maxlength="36"
          placeholder="All authorized devices" /></label
      ><button class="btn-ghost" :disabled="busy || loading">
        Apply device filter
      </button>
    </form>
    <p v-if="loading && !overview" role="status">Loading device operations…</p>
    <template v-if="overview">
      <p class="managed-note">
        Management is opt-in for each credential epoch. Unknown hardware is
        ineligible. Healthy means an authenticated device claim, not independent
        hardware attestation. Firmware download traffic is separate from
        telemetry:
        {{
          overview.transferObservations !== '0'
            ? overview.transferBytes
            : 'Unavailable — no recorded transfers'
        }}
        application bytes sent in the last 30 days.
      </p>
      <template v-if="firmwareOnly">
        <section class="managed-card">
          <h2>1. Trust an offline signing key</h2>
          <p>
            Keep the private key offline. Provision the matching public key and
            fingerprint into your firmware before enabling OTA.
          </p>
          <form
            v-if="can('firmware.manage_signing_keys')"
            @submit.prevent="saveKey"
          >
            <label
              >Key name<input
                v-model="keyName"
                required
                maxlength="80" /></label
            ><label
              >Public P-256 PEM<textarea
                v-model="keyPem"
                required
                rows="4"
                maxlength="2048"
                placeholder="-----BEGIN PUBLIC KEY-----"
              /></label
            ><button class="btn-primary" :disabled="busy">
              Register public key
            </button>
          </form>
          <ul class="managed-list">
            <li v-for="key in overview.keys" :key="key.id">
              <strong>{{ key.name }}</strong
              ><span>{{ key.revoked_at ? 'Revoked' : 'Trusted' }}</span
              ><code>{{ key.id }}</code
              ><code>{{ key.fingerprint }}</code
              ><button
                v-if="!key.revoked_at && can('firmware.manage_signing_keys')"
                class="btn-ghost"
                :disabled="busy"
                @click="revokeKey(key)"
              >
                Revoke key
              </button>
            </li>
          </ul>
          <p v-if="!overview.keys.length">No signing keys registered.</p>
        </section>
        <section class="managed-card">
          <h2>2. Upload a signed release</h2>
          <p>
            Use the offline signing tool to produce the signed JSON. Select that
            file and the exact compiled ESP binary. The service verifies the
            signature, full-file hash, length and image header before approval.
          </p>
          <form v-if="can('firmware.upload')" @submit.prevent="upload">
            <label
              >Signed release JSON<input
                type="file"
                accept=".json,application/json"
                required
                @change="pickManifest" /></label
            ><label
              >Compiled firmware binary (up to 4 MiB)<input
                type="file"
                accept=".bin,application/octet-stream"
                required
                @change="pickBinary" /></label
            ><label
              >Release notes<textarea
                v-model="releaseNotes"
                maxlength="4000"
                rows="2"
              /></label
            ><button
              class="btn-primary"
              :disabled="busy || !signedFile || !binaryFile"
            >
              Verify and upload
            </button>
          </form>
          <ul class="managed-list">
            <li v-for="a in overview.artifacts" :key="a.id">
              <strong
                >{{ a.manifest.hardwareModel }} /
                {{ a.manifest.hardwareRevision }} ·
                {{ a.manifest.version }}</strong
              ><span>{{ a.state }} · {{ a.size }} B · {{ a.channel }}</span
              ><code>{{ a.id }}</code>
              <details>
                <summary>Integrity and compatibility</summary>
                <code>{{ a.sha256 }}</code>
                <p>
                  Platform: {{ a.manifest.platform }} · security version:
                  {{ a.manifest.securityVersion }} · minimum bootloader:
                  {{ a.manifest.minimumBootloaderVersion }}
                </p>
                <p>{{ a.release_notes || 'No release notes.' }}</p>
              </details>
              <button
                v-if="a.state === 'verified' && can('firmware.approve')"
                class="btn-ghost"
                :disabled="busy"
                @click="approve(a)"
              >
                Approve release
              </button>
            </li>
          </ul>
          <p v-if="!overview.artifacts.length">
            No releases yet. Uploading does not deploy firmware.
          </p>
        </section>
      </template>
      <section class="managed-card">
        <h2>
          {{
            firmwareOnly
              ? '3. Preview a firmware rollout'
              : 'New configuration or firmware rollout'
          }}
        </h2>
        <form
          v-if="can('configuration.update') || can('firmware.deploy')"
          @submit.prevent="preview"
        >
          <div class="managed-grid">
            <label
              >Operation<select v-model="kind" aria-label="Operation">
                <option v-if="can('firmware.deploy')" value="firmware">
                  Firmware update
                </option>
                <option
                  v-if="can('configuration.update')"
                  value="configuration"
                >
                  Remote configuration
                </option>
              </select></label
            ><label v-if="kind === 'firmware'"
              >Approved release<select
                v-model="artifactId"
                aria-label="Approved release"
                required
              >
                <option value="">Choose a release</option>
                <option v-for="a in approved" :key="a.id" :value="a.id">
                  {{ a.manifest.hardwareModel }} / {{ a.manifest.version }}
                </option>
              </select></label
            >
          </div>
          <fieldset v-if="kind === 'configuration'">
            <legend>Typed device settings</legend>
            <div class="managed-grid">
              <label
                >Reporting interval (seconds)<input
                  v-model.number="reportInterval"
                  type="number"
                  min="10"
                  max="86400"
                  required /></label
              ><label
                >Sampling interval (seconds)<input
                  v-model.number="sampleInterval"
                  type="number"
                  min="1"
                  :max="reportInterval"
                  required /></label
              ><label
                >Diagnostic level<select
                  v-model="diagnostic"
                  aria-label="Diagnostic level"
                >
                  <option>none</option>
                  <option>error</option>
                  <option>info</option>
                </select></label
              >
            </div>
            <p>
              These settings require a compatible application callback. Schema
              slots, credentials and network secrets cannot be changed here.
            </p>
          </fieldset>
          <div class="managed-grid">
            <label
              >Target selection<select
                v-model="selectionMode"
                aria-label="Target selection"
              >
                <option value="ids">Explicit device IDs</option>
                <option value="group">Group ID</option>
                <option value="tag">Tag</option>
                <option value="all">All devices in this workspace</option>
              </select></label
            ><label v-if="selectionMode !== 'all'"
              >{{
                selectionMode === 'ids'
                  ? 'Device UUIDs (comma or newline separated)'
                  : selectionMode === 'group'
                    ? 'Group UUID'
                    : 'Normalized tag'
              }}<textarea
                v-model="selectionText"
                required
                rows="2"
                maxlength="262144"
              />
            </label>
          </div>
          <details>
            <summary>Rollout safety settings</summary>
            <div class="managed-grid">
              <label
                >Cumulative wave percentages<input
                  v-model="waves"
                  required
                  placeholder="1,10,25,100" /></label
              ><label
                >Observation window (seconds)<input
                  v-model.number="observation"
                  type="number"
                  min="0"
                  max="86400" /></label
              ><label
                >Maximum simultaneous operations<input
                  v-model.number="maxConcurrent"
                  type="number"
                  min="1"
                  max="100" /></label
              ><label
                >Assignments per minute<input
                  v-model.number="perMinute"
                  type="number"
                  min="1"
                  max="1000" /></label
              ><label
                >Pause at failure or unknown percentage<input
                  v-model.number="failurePercent"
                  type="number"
                  min="0"
                  max="100" /></label
              ><label
                >Confirmation timeout (seconds)<input
                  v-model.number="timeout"
                  type="number"
                  min="60"
                  max="604800" /></label
              ><label
                >Start time (local, optional)<input
                  v-model="startsAt"
                  type="datetime-local" /></label
              ><label
                >End time (local, optional)<input
                  v-model="endsAt"
                  type="datetime-local"
              /></label>
            </div>
            <label class="managed-check"
              ><input v-model="manualAdvance" type="checkbox" /> Require manual
              advancement after each successful wave</label
            >
            <p>
              Every target in a wave must report success and complete the
              observation window. Unknown outcomes pause at the configured
              threshold. A larger percentage does not make incomplete evidence
              safe.
            </p>
          </details>
          <button class="btn-primary" :disabled="busy">Create preview</button>
        </form>
        <p v-else>
          Your role can inspect operations. Ask an administrator to create a
          rollout.
        </p>
      </section>
      <section class="managed-card">
        <h2>Rollouts</h2>
        <p>
          Preview creates a durable draft, not a device command. Review eligible
          targets before explicitly confirming.
        </p>
        <ul class="managed-list">
          <li v-for="r in overview.rollouts" :key="r.id">
            <div class="managed-header">
              <strong>{{ r.kind }} · {{ r.state }}</strong
              ><span>Wave {{ r.wave }} / {{ r.waves }}</span>
            </div>
            <code>{{ r.id }}</code>
            <p>
              {{ r.eligible }} eligible · {{ r.ineligible }} ineligible ·
              {{ r.reason || 'No pause reason' }}
            </p>
            <p>{{ counts(r.counts) }}</p>
            <div class="managed-actions">
              <button
                class="btn-ghost"
                :disabled="busy"
                @click="showTargets(r.id)"
              >
                Review targets</button
              ><button
                v-if="r.state === 'draft' && canDeploy(r)"
                class="btn-primary"
                :disabled="busy || !r.eligible"
                @click="confirmRollout(r)"
              >
                Confirm rollout</button
              ><button
                v-if="
                  ['running', 'scheduled'].includes(r.state) &&
                  can('firmware.cancel')
                "
                class="btn-ghost"
                :disabled="busy"
                @click="rolloutAction(r, 'pause')"
              >
                Pause</button
              ><button
                v-if="r.state === 'paused' && canDeploy(r)"
                class="btn-ghost"
                :disabled="busy"
                @click="rolloutAction(r, 'resume')"
              >
                Resume</button
              ><button
                v-if="
                  r.state === 'running' &&
                  r.waveReady &&
                  r.wave < r.waves &&
                  canDeploy(r)
                "
                class="btn-ghost"
                :disabled="busy"
                @click="rolloutAction(r, 'advance')"
              >
                Advance wave</button
              ><button
                v-if="
                  ['draft', 'scheduled', 'running', 'paused'].includes(
                    r.state,
                  ) && can('firmware.cancel')
                "
                class="btn-ghost"
                :disabled="busy"
                @click="cancelRollout(r)"
              >
                Cancel unstarted work
              </button>
            </div>
          </li>
        </ul>
        <p v-if="!overview.rollouts.length">
          No rollouts. Devices continue their existing telemetry workflow.
        </p>
        <div v-if="targets">
          <h3>Target preview / history</h3>
          <code>{{ targets.id }}</code>
          <p>{{ targets.count }} total targets · page {{ targetPage + 1 }}</p>
          <ul class="managed-list">
            <li v-for="t in targets.targets" :key="t.device_id">
              <NuxtLink :to="'/dashboard?device=' + t.device_id">{{
                t.name
              }}</NuxtLink
              ><code>{{ t.device_id }}</code
              ><span
                >Wave {{ t.wave }} ·
                {{ t.eligible ? 'Eligible' : 'Ineligible: ' + t.reason }} ·
                {{ t.operation_state || t.state }}</span
              ><span v-if="t.error_category">{{ t.error_category }}</span>
            </li>
          </ul>
          <div class="managed-actions">
            <button
              class="btn-ghost"
              :disabled="busy || targetPage === 0"
              @click="targetMove(-1)"
            >
              Previous targets</button
            ><button
              class="btn-ghost"
              :disabled="busy || (targetPage + 1) * 50 >= targets.count"
              @click="targetMove(1)"
            >
              Next targets
            </button>
          </div>
        </div>
      </section>
      <section class="managed-card">
        <h2>Device capabilities and configuration</h2>
        <p>
          Capabilities are reported by the device. Enable management only after
          verifying the hardware, rollback bootloader and signing pins. Existing
          telemetry-only firmware remains unsupported.
        </p>
        <ul class="managed-list">
          <li v-for="p in overview.profiles" :key="p.device_id">
            <NuxtLink :to="'/dashboard?device=' + p.device_id">{{
              p.name
            }}</NuxtLink
            ><code>{{ p.device_id }}</code>
            <p>
              {{ p.capabilities.platform }} ·
              {{ p.capabilities.hardwareModel }} /
              {{ p.capabilities.hardwareRevision }} ·
              {{ p.enabled ? 'Management enabled' : 'Approval required' }} · OTA
              {{
                p.capabilities.ota && p.capabilities.rollback
                  ? 'reported capable'
                  : 'unsupported'
              }}
            </p>
            <p>Last check-in: {{ date(p.last_checkin) }}</p>
            <details>
              <summary>Desired and reported state</summary>
              <p>Desired configuration</p>
              <pre>{{
                JSON.stringify(p.desired_config, null, 2) || 'Not assigned'
              }}</pre>
              <p>Reported configuration</p>
              <pre>{{
                JSON.stringify(p.reported_config, null, 2) ||
                'No device acknowledgment'
              }}</pre>
              <p>Reported firmware</p>
              <pre>{{
                JSON.stringify(p.reported_firmware, null, 2) ||
                'No health confirmation'
              }}</pre>
              <p>
                Application security version: {{ p.security_version }} · current
                epoch: {{ p.wire_device_id }}
              </p>
            </details>
            <button
              v-if="can('device_operations.manage')"
              class="btn-ghost"
              :disabled="busy"
              @click="enableProfile(p)"
            >
              {{ p.enabled ? 'Disable management' : 'Enable management' }}
            </button>
          </li>
        </ul>
        <p v-if="!overview.profiles.length">
          No compatible agent has registered on this page.
        </p>
      </section>
      <section class="managed-card">
        <h2>Operation evidence</h2>
        <p>
          Server scheduling and authenticated device claims are recorded
          separately. A timeout is Unknown, not proof of a failed installation.
        </p>
        <ul class="managed-list">
          <li v-for="o in overview.operations" :key="o.id">
            <strong>{{ o.kind }} · {{ o.state }}</strong
            ><code>{{ o.id }}</code
            ><NuxtLink :to="'/dashboard?device=' + o.device_id"
              >Device {{ o.device_id }}</NuxtLink
            >
            <p>
              Generation {{ o.generation }} ·
              {{ o.error_category || 'No recorded error' }}
            </p>
            <details>
              <summary>Recorded timeline</summary>
              <ol>
                <li v-for="e in o.events" :key="e.id">
                  {{ date(e.created_at) }} — {{ e.stage }} · {{ e.evidence }}
                  {{ e.category }}
                </li>
              </ol>
            </details>
          </li>
        </ul>
        <p v-if="!overview.operations.length">
          No assigned operations on this page.
        </p>
      </section>
      <div class="managed-actions">
        <button
          class="btn-ghost"
          :disabled="busy || page === 0"
          @click="move(-1)"
        >
          Previous devices / operations</button
        ><span>Page {{ page + 1 }} · newest 50 rollouts and 100 artifacts</span
        ><button
          class="btn-ghost"
          :disabled="
            busy ||
            (overview.profiles.length < 50 && overview.operations.length < 50)
          "
          @click="move(1)"
        >
          Next devices / operations
        </button>
      </div>
    </template>
  </div>
</template>
<script setup lang="ts">
const route = useRoute(),
  deviceFilter = ref(
    typeof route.query.device === 'string' ? route.query.device : '',
  )
const props = defineProps<{ firmwareOnly?: boolean }>(),
  { currentOrgId, ensureOrganization, can } = useOrganization()
const overview = ref<any>(null),
  targets = ref<any>(null),
  error = ref(''),
  notice = ref(''),
  loading = ref(false),
  busy = ref(false),
  page = ref(0),
  targetPage = ref(0)
const keyName = ref(''),
  keyPem = ref(''),
  signedFile = ref<File | null>(null),
  binaryFile = ref<File | null>(null),
  releaseNotes = ref(''),
  kind = ref('configuration'),
  artifactId = ref(''),
  selectionMode = ref('ids'),
  selectionText = ref(''),
  waves = ref('1,10,25,100'),
  observation = ref(60),
  maxConcurrent = ref(10),
  perMinute = ref(30),
  failurePercent = ref(5),
  timeout = ref(3600),
  startsAt = ref(''),
  endsAt = ref(''),
  manualAdvance = ref(true),
  reportInterval = ref(60),
  sampleInterval = ref(60),
  diagnostic = ref('error')
const approved = computed(
  () =>
    overview.value?.artifacts.filter((a: any) => a.state === 'approved') || [],
)
let targetGeneration = 0
let generation = 0,
  initialized = false
function date(v: any) {
  return v ? new Date(v).toLocaleString() : 'Unavailable'
}
function counts(v: any) {
  return (
    Object.entries(v || {})
      .map(([k, n]) => `${k}: ${n}`)
      .join(' · ') || 'No assignments yet'
  )
}
function canDeploy(r: any) {
  return can(r.kind === 'firmware' ? 'firmware.deploy' : 'configuration.deploy')
}
function pickManifest(e: Event) {
  signedFile.value = (e.target as HTMLInputElement).files?.[0] || null
}
function pickBinary(e: Event) {
  binaryFile.value = (e.target as HTMLInputElement).files?.[0] || null
}
async function refresh() {
  const org = currentOrgId.value,
    g = ++generation
  if (!org) return
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch('/api/device-operations', {
      query: {
        orgId: org,
        page: page.value,
        deviceId: deviceFilter.value || undefined,
      },
    })
    if (g === generation && org === currentOrgId.value) overview.value = data
  } catch (e: any) {
    if (g === generation) {
      error.value = e.data?.message || 'Unable to load device operations.'
      overview.value = null
    }
  } finally {
    if (g === generation) loading.value = false
  }
}
async function perform(work: (org: string) => Promise<void>) {
  if (busy.value || !currentOrgId.value) return
  const org = currentOrgId.value
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await work(org)
    if (org === currentOrgId.value) await refresh()
  } catch (e: any) {
    if (org === currentOrgId.value)
      error.value = e.data?.message || e.message || 'Device operation failed.'
  } finally {
    busy.value = false
  }
}
async function action(org: string, a: string, data: any) {
  return $fetch('/api/device-operations/action', {
    method: 'POST',
    body: { orgId: org, action: a, data },
  })
}
function saveKey() {
  return perform(async (org) => {
    await action(org, 'key', {
      id: crypto.randomUUID(),
      name: keyName.value,
      publicPem: keyPem.value,
    })
    keyName.value = ''
    keyPem.value = ''
    notice.value =
      'Public signing key registered. Provision its fingerprint into the device separately.'
  })
}
function revokeKey(k: any) {
  if (
    !confirm(
      'Revoke this signing key? New downloads and assignments stop. An offline device with a previously downloaded image may still install it. This does not change its embedded trust pins.',
    )
  )
    return
  return perform(async (org) => {
    await action(org, 'revoke_key', { id: k.id })
  })
}
function upload() {
  return perform(async (org) => {
    if (
      !signedFile.value ||
      !binaryFile.value ||
      signedFile.value.size > 16384 ||
      binaryFile.value.size > 4194304
    )
      throw Error('Select a signed JSON under 16 KiB and a binary under 4 MiB.')
    const signed = JSON.parse(await signedFile.value.text())
    if (signed.manifest?.organizationId !== org)
      throw Error('The signed manifest belongs to another workspace.')
    const id = signed.manifest.artifactId
    const existing = overview.value.artifacts.find((a: any) => a.id === id)
    if (!existing)
      await action(org, 'artifact', {
        ...signed,
        releaseNotes: releaseNotes.value,
      })
    if (currentOrgId.value !== org) return
    await $fetch('/api/device-operations/artifacts/' + id, {
      method: 'PUT',
      query: { orgId: org },
      headers: { 'Content-Type': 'application/octet-stream' },
      body: binaryFile.value,
    })
    notice.value =
      'Artifact verified. Administrator approval is required before deployment.'
  })
}
function approve(a: any) {
  if (
    !confirm(
      `Approve immutable release ${a.manifest.version} for eligible hardware? Approval alone does not deploy it.`,
    )
  )
    return
  return perform(async (org) => {
    await action(org, 'approve', { id: a.id })
  })
}
function preview() {
  return perform(async (org) => {
    const selection: any =
      selectionMode.value === 'all'
        ? { all: true }
        : selectionMode.value === 'ids'
          ? { ids: selectionText.value.split(/[\s,]+/).filter(Boolean) }
          : { [selectionMode.value]: selectionText.value.trim() }
    const definition: any = {
      kind: kind.value,
      selection,
      wavePercentages: waves.value.split(',').map((v) => Number(v.trim())),
      manualAdvance: manualAdvance.value,
      observationSeconds: observation.value,
      maxConcurrent: maxConcurrent.value,
      perMinute: perMinute.value,
      failurePercent: failurePercent.value,
      timeoutSeconds: timeout.value,
    }
    if (kind.value === 'firmware') definition.artifactId = artifactId.value
    else
      definition.configuration = {
        reportIntervalSeconds: reportInterval.value,
        sampleIntervalSeconds: sampleInterval.value,
        diagnosticLevel: diagnostic.value,
      }
    if (startsAt.value)
      definition.startsAt = new Date(startsAt.value).toISOString()
    if (endsAt.value) definition.endsAt = new Date(endsAt.value).toISOString()
    const r: any = await $fetch('/api/device-operations/preview', {
      method: 'POST',
      body: { orgId: org, requestId: crypto.randomUUID(), definition },
    })
    if (currentOrgId.value === org) {
      notice.value =
        'Draft saved. Review target eligibility and confirm before assignments begin.'
      await showTargets(r.id)
    }
  })
}
async function showTargets(id: string) {
  if (targets.value?.id !== id) targetPage.value = 0
  const request = ++targetGeneration
  const org = currentOrgId.value,
    g = generation
  try {
    const data = await $fetch('/api/device-operations/rollouts/' + id, {
      query: { orgId: org, page: targetPage.value },
    })
    if (
      org === currentOrgId.value &&
      g === generation &&
      request === targetGeneration
    )
      targets.value = data
  } catch (e: any) {
    if (org === currentOrgId.value)
      error.value = e.data?.message || 'Unable to review targets.'
  }
}
function confirmRollout(r: any) {
  if (
    !confirm(
      `Confirm ${r.kind} rollout for ${r.eligible} eligible devices in ${r.waves} waves? Devices may apply these changes after their next authenticated check-in.`,
    )
  )
    return
  return rolloutAction(r, 'confirm')
}
function cancelRollout(r: any) {
  if (
    !confirm(
      'Cancel only unstarted work? Assigned or installing devices may continue. Cancellation is not a physical rollback.',
    )
  )
    return
  return rolloutAction(r, 'cancel')
}
function rolloutAction(r: any, a: string) {
  return perform(async (org) => {
    await action(org, a, { id: r.id, kind: r.kind, confirm: a === 'confirm' })
  })
}
function enableProfile(p: any) {
  if (
    !confirm(
      p.enabled
        ? 'Disable future management requests and downloads for this epoch? In-flight device work may continue.'
        : 'Enable management for this reported credential epoch? Verify its firmware, pins and rollback capability first.',
    )
  )
    return
  return perform(async (org) => {
    await action(org, 'enable_device', { id: p.device_id, enabled: !p.enabled })
  })
}
function applyDeviceFilter() {
  page.value = 0
  void refresh()
}
watch(
  () => route.query.device,
  (value) => {
    deviceFilter.value = typeof value === 'string' ? value : ''
    page.value = 0
    if (initialized) void refresh()
  },
)
function move(delta: number) {
  page.value += delta
  void refresh()
}
function targetMove(delta: number) {
  targetPage.value += delta
  void showTargets(targets.value.id)
}
onMounted(async () => {
  await ensureOrganization()
  kind.value =
    props.firmwareOnly && can('firmware.deploy') ? 'firmware' : 'configuration'
  initialized = true
  await refresh()
})
watch(currentOrgId, () => {
  generation++
  targetGeneration++
  overview.value = null
  targets.value = null
  page.value = 0
  deviceFilter.value = ''
  targetPage.value = 0
  notice.value = ''
  keyPem.value = ''
  signedFile.value = null
  binaryFile.value = null
  if (initialized) void refresh()
})
</script>
<style scoped>
.managed-page {
  display: grid;
  gap: 1.25rem;
  max-width: 1100px;
  margin: auto;
}
.managed-header,
.managed-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.managed-header nav {
  display: flex;
  gap: 1.5rem;
}
.managed-page h1 {
  font-size: 1.7rem;
}
.managed-page h2 {
  font-size: 1.2rem;
  margin-bottom: 0.75rem;
}
.managed-page p {
  color: #aaa8b8;
  line-height: 1.65;
  margin: 0.5rem 0;
}
.managed-card {
  padding: 1.5rem;
  border: 1px solid #302c3e;
  border-radius: 12px;
  background: #14121c;
}
.managed-page form {
  display: grid;
  gap: 1rem;
  margin: 1rem 0;
}
.managed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 1rem;
}
.managed-page label {
  display: grid;
  gap: 0.4rem;
  font-size: 0.88rem;
}
.managed-page input,
.managed-page textarea,
.managed-page select {
  width: 100%;
  background: #1d1928;
  color: #eee;
  border: 1px solid #443a56;
  border-radius: 7px;
  padding: 0.65rem;
  box-sizing: border-box;
}
.managed-page input[type='checkbox'] {
  width: auto;
}
.managed-check {
  display: flex !important;
  align-items: center;
  margin-top: 1rem;
}
.managed-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}
.managed-list > li {
  display: grid;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px solid #302c3e;
  border-radius: 8px;
  min-width: 0;
}
.managed-page code,
.managed-page pre {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 0.8rem;
  color: #c1a8ef;
}
.managed-page summary {
  cursor: pointer;
  padding: 0.5rem 0;
}
.managed-page a {
  color: #c1a8ef;
}
.managed-error {
  color: #f9a7b0 !important;
}
.managed-note {
  padding: 1rem;
  border-left: 3px solid #9b70e0;
}
.managed-page fieldset {
  border: 1px solid #443a56;
  border-radius: 8px;
  padding: 1rem;
}
.managed-page button:disabled {
  opacity: 0.5;
}
.managed-actions {
  justify-content: flex-start;
}
.managed-page :focus-visible {
  outline: 2px solid #c1a8ef;
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .managed-card {
    padding: 1rem;
  }
  .managed-grid {
    grid-template-columns: 1fr;
  }
  .managed-actions {
    align-items: stretch;
  }
  .managed-actions button {
    width: 100%;
  }
}
</style>
