<template>
  <main class="mx-auto max-w-6xl space-y-5">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">Integrations</h1>
        <p class="mt-1 text-sm text-[#9AA3B2]">
          Connect Struct to your existing backend. Keep your infrastructure.
        </p>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/docs/integrations" class="btn-ghost text-xs"
          >Setup guide</NuxtLink
        ><NuxtLink to="/dashboard/deliveries" class="btn-ghost text-xs"
          >Delivery history</NuxtLink
        ><NuxtLink to="/dashboard/destinations" class="btn-ghost text-xs"
          >Existing webhooks</NuxtLink
        >
      </div>
    </header>
    <div v-if="!available" class="card p-5 text-sm text-[#9AA3B2]">
      Backend integrations require migration 036 and explicit server/worker
      activation. Existing webhooks remain available. No destinations have been
      enabled automatically.
    </div>
    <template v-else>
      <p
        v-if="error"
        role="alert"
        class="rounded-lg border border-red-900 p-3 text-sm text-red-300"
      >
        {{ error }}
      </p>
      <p
        v-if="notice"
        role="status"
        class="rounded-lg border border-[#5617fc] p-3 text-sm"
      >
        {{ notice }}
      </p>
      <section
        v-if="!editing"
        aria-label="Integration catalog"
        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <button
          v-for="p in INTEGRATION_CATALOG"
          :key="p.kind"
          class="card p-4 text-left transition-colors hover:border-[#5617fc] disabled:opacity-50"
          :disabled="!canWrite || busy"
          @click="begin(p.kind)"
        >
          <span class="text-xs text-[#b79bff]">{{ p.group }}</span>
          <h2 class="mt-1 font-medium">{{ p.title }}</h2>
          <p class="mt-2 text-xs text-[#9AA3B2]">{{ p.description }}</p>
          <span class="mt-3 block text-xs text-[#b79bff]"
            >Add connection →</span
          >
        </button>
      </section>
      <section
        v-if="editing"
        class="card p-4 sm:p-6"
        aria-label="Integration setup"
      >
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 class="font-semibold">
              {{ editing.id ? 'Edit' : 'Connect' }} {{ provider.title }}
            </h2>
            <p class="mt-1 text-xs text-[#9AA3B2]">
              Step {{ step + 1 }} of 7 · {{ steps[step] }}
            </p>
          </div>
          <button class="btn-ghost text-xs" :disabled="busy" @click="close">
            Close setup
          </button>
        </div>
        <ol class="mb-5 flex gap-1" aria-label="Setup progress">
          <li
            v-for="(label, index) in steps"
            :key="label"
            class="h-1 flex-1 rounded"
            :class="index <= step ? 'bg-[#7c4dff]' : 'bg-[#2A2F3A]'"
            :aria-label="label"
            :aria-current="index === step ? 'step' : undefined"
          />
        </ol>
        <form class="space-y-4" @submit.prevent="next">
          <template v-if="step === 0"
            ><label class="label" for="integration-provider">Destination</label
            ><select
              id="integration-provider"
              v-model="editing.kind"
              class="input"
              :disabled="!!editing.id"
              @change="changeKind"
            >
              <option
                v-for="p in INTEGRATION_CATALOG"
                :key="p.kind"
                :value="p.kind"
              >
                {{ p.title }}
              </option>
            </select>
            <p class="text-sm text-[#9AA3B2]">
              New connections start disabled. Setup does not forward customer
              telemetry. Existing webhook contracts remain unchanged.
            </p></template
          >
          <template v-if="step === 1"
            ><label class="label" for="integration-name">Connection name</label
            ><input
              id="integration-name"
              v-model="editing.name"
              class="input"
              required
              maxlength="100"
            />
            <div class="grid gap-4 sm:grid-cols-2">
              <div v-for="field in provider.fields" :key="field.key">
                <label class="label" :for="`connection-${field.key}`">{{
                  field.label
                }}</label
                ><input
                  :id="`connection-${field.key}`"
                  v-model="editing.config[field.key]"
                  class="input mono"
                  :placeholder="field.example"
                  :required="
                    ![
                      'port',
                      'schema',
                      'messageGroup',
                      'source',
                      'detailType',
                    ].includes(field.key)
                  "
                />
              </div>
            </div>
            <label v-if="editing.id" class="flex items-center gap-2 text-sm"
              ><input v-model="rotate" type="checkbox" />Replace stored
              credentials</label
            >
            <fieldset
              v-if="!editing.id || rotate"
              class="grid gap-4 rounded-lg border border-[#2A2F3A] p-4 sm:grid-cols-2"
            >
              <legend class="px-1 text-xs text-[#b79bff]">
                Encrypted server-side credentials
              </legend>
              <div
                v-for="secret in provider.secrets"
                :key="secret.key"
                :class="secret.multiline ? 'sm:col-span-2' : ''"
              >
                <label class="label" :for="`secret-${secret.key}`">{{
                  secret.label
                }}</label
                ><textarea
                  v-if="secret.multiline"
                  :id="`secret-${secret.key}`"
                  v-model="credentials[secret.key]"
                  class="input min-h-24 font-mono text-xs"
                  :required="!secret.optional"
                  autocomplete="off"
                  spellcheck="false"
                /><input
                  v-else
                  :id="`secret-${secret.key}`"
                  v-model="credentials[secret.key]"
                  class="input"
                  type="password"
                  :required="!secret.optional"
                  autocomplete="new-password"
                />
              </div>
            </fieldset>
            <p class="text-xs text-[#9AA3B2]">
              Saved credentials cannot be revealed or exported. Use scoped
              provider permissions. Public endpoints and verified TLS are
              required.
              <NuxtLink
                :to="`/docs/integrations-${editing.kind}`"
                class="text-[#b79bff] underline"
                >Provider setup and permissions</NuxtLink
              >
            </p>
            <details v-if="editing.kind === 'http'">
              <summary class="text-xs text-[#b79bff]">
                Nonsecret request metadata
              </summary>
              <label class="label mt-2" for="http-metadata"
                >JSON x-meta-* headers</label
              ><textarea
                id="http-metadata"
                v-model="httpHeaders"
                class="input font-mono text-xs"
              />
            </details>
          </template>
          <template v-if="step === 2"
            ><p class="text-sm text-[#9AA3B2]">
              All telemetry is the default. Conditional routing retains the
              existing Scale entitlement. Multiple matching conditions produce
              one delivery per destination.
            </p>
            <IntegrationRuleEditor
              v-model="editing.route"
              :key="editing.id || editing.kind"
          /></template>
          <template v-if="step === 3"
            ><IntegrationMappingEditor v-model="editing.mapping"
          /></template>
          <template v-if="step === 4"
            ><h3 class="font-medium">Review before saving</h3>
            <p class="text-sm text-[#9AA3B2]">
              {{ editing.name }} · {{ provider.title }} ·
              {{
                editing.id
                  ? 'Update version ' + editing.version
                  : 'Disabled until explicitly enabled'
              }}
            </p>
            <pre
              class="max-h-80 overflow-auto rounded-lg bg-[#0b0d12] p-3 text-xs"
              >{{ review }}</pre
            >
            <p class="text-xs text-amber-200">
              Queued events retain their earlier configuration and mapping.
              Credential replacement affects subsequent attempts, including old
              jobs. Pause first when changing permissions or resources.
            </p></template
          >
          <template v-if="step === 5"
            ><p class="text-sm text-[#9AA3B2]">
              Configuration saved. Read-only verification never sends telemetry.
              Some send-only credentials support configuration checks only.
            </p>
            <button
              type="button"
              class="btn-ghost"
              :disabled="busy"
              @click="action(saved!, 'check')"
            >
              Verify connection
            </button>
            <p class="text-xs text-[#9AA3B2]">
              You can send an explicit test event from the connection details
              after setup. Required-field transformations may reject the generic
              test payload.
            </p></template
          >
          <template v-if="step === 6"
            ><p class="text-sm text-[#9AA3B2]">
              Enable forwarding for new matching readings. Stored historical
              telemetry is not backfilled. Delivery history records acceptance,
              retry and failure independently for each destination.
            </p>
            <label class="flex items-start gap-2 text-sm"
              ><input v-model="enableConfirm" type="checkbox" class="mt-1" />I
              reviewed this destination and authorize forwarding matching
              telemetry.</label
            ><button
              type="button"
              class="btn-primary"
              :disabled="busy || !enableConfirm"
              @click="enableSaved"
            >
              Enable integration
            </button></template
          >
          <div class="flex justify-between border-t border-[#2A2F3A] pt-4">
            <button
              type="button"
              class="btn-ghost"
              :disabled="busy || step === 0 || step > 4"
              @click="back"
            >
              Back</button
            ><button
              v-if="step < 6"
              type="submit"
              class="btn-primary"
              :disabled="busy"
            >
              {{
                busy
                  ? 'Working…'
                  : step === 4
                    ? 'Save configuration'
                    : 'Continue'
              }}</button
            ><button v-else type="button" class="btn-ghost" @click="close">
              Finish without enabling
            </button>
          </div>
        </form>
      </section>
      <section
        class="card divide-y divide-[#2A2F3A]"
        aria-label="Your connections"
      >
        <div class="flex items-center justify-between p-4">
          <h2 class="font-medium">Your connections</h2>
          <button
            class="btn-ghost text-xs"
            :disabled="busy || loading"
            @click="load"
          >
            {{ loading ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
        <p
          v-if="!integrations.length && !loading"
          class="p-6 text-sm text-[#9AA3B2]"
        >
          Choose a destination above to create your first connection.
        </p>
        <article
          v-for="item in integrations"
          :key="item.destination_id"
          class="space-y-3 p-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="font-medium">{{ item.destination.name }}</h3>
              <p class="mt-1 text-xs text-[#9AA3B2]">
                {{ title(item.kind) }} · Version {{ item.version }} ·
                {{
                  item.destination.paused_at
                    ? 'Paused'
                    : item.destination.enabled
                      ? 'Enabled'
                      : 'Disabled'
                }}
              </p>
            </div>
            <button
              class="btn-ghost text-xs"
              @click="
                selected =
                  selected === item.destination_id ? null : item.destination_id
              "
            >
              {{
                selected === item.destination_id
                  ? 'Hide details'
                  : 'View connection'
              }}
            </button>
          </div>
          <p class="text-xs text-[#9AA3B2]">
            {{ healthFor(item.destination_id) }}
          </p>
          <div
            v-if="selected === item.destination_id"
            class="space-y-4 border-t border-[#2A2F3A] pt-3"
          >
            <p class="text-xs text-[#9AA3B2]">
              Credentials stored encrypted ·
              {{ item.last_check?.detail || 'Connection not checked' }}
            </p>
            <pre
              class="max-h-64 overflow-auto rounded-lg bg-[#0b0d12] p-3 text-xs"
              >{{
                JSON.stringify(
                  {
                    configuration: item.config,
                    route: item.route,
                    mapping: item.mapping,
                  },
                  null,
                  2,
                )
              }}</pre
            >
            <div v-if="canWrite" class="flex flex-wrap gap-2">
              <button
                class="btn-ghost text-xs"
                :disabled="
                  busy ||
                  !item.destination.enabled ||
                  !!item.destination.paused_at
                "
                @click="confirmAction(item, 'remap')"
              >
                Retry failures with current mapping
              </button>
              <button
                class="btn-ghost text-xs"
                :disabled="busy"
                @click="edit(item)"
              >
                Edit configuration / routing / mapping</button
              ><button
                class="btn-ghost text-xs"
                :disabled="busy"
                @click="action(item, 'check')"
              >
                Verify connection</button
              ><button
                class="btn-ghost text-xs"
                :disabled="busy"
                @click="confirmAction(item, 'test_send')"
              >
                Send explicit test event</button
              ><button
                v-if="item.destination.enabled"
                class="btn-ghost text-xs"
                :disabled="busy"
                @click="
                  action(item, item.destination.paused_at ? 'resume' : 'pause')
                "
              >
                {{ item.destination.paused_at ? 'Resume' : 'Pause' }}</button
              ><button
                class="btn-ghost text-xs"
                :disabled="busy"
                @click="
                  confirmAction(
                    item,
                    item.destination.enabled ? 'disable' : 'enable',
                  )
                "
              >
                {{ item.destination.enabled ? 'Disable' : 'Enable' }}</button
              ><button
                class="btn-ghost text-xs text-red-300"
                :disabled="busy"
                @click="confirmAction(item, 'delete')"
              >
                Delete connection
              </button>
            </div>
            <details>
              <summary class="cursor-pointer text-xs text-[#b79bff]">
                Preview routing and mapping
              </summary>
              <label class="label mt-3" :for="`preview-${item.destination_id}`"
                >Sample payload JSON</label
              ><textarea
                :id="`preview-${item.destination_id}`"
                v-model="sample"
                class="input min-h-24 font-mono text-xs"
              />
              <div class="mt-2 grid gap-2 sm:grid-cols-2">
                <label class="text-xs"
                  >Sample device ID<input
                    v-model="sampleDevice"
                    class="input mt-1"
                    placeholder="device UUID" /></label
                ><label class="text-xs"
                  >Sample schema slot<input
                    v-model.number="sampleSlot"
                    type="number"
                    min="0"
                    max="15"
                    class="input mt-1"
                /></label>
              </div>
              <button
                class="btn-ghost mt-2 text-xs"
                :disabled="busy"
                @click="preview(item)"
              >
                Preview without sending
              </button>
              <pre
                v-if="previewOutput"
                class="mt-2 max-h-64 overflow-auto text-xs"
                >{{ previewOutput }}</pre
              >
            </details>
            <NuxtLink
              to="/dashboard/deliveries"
              class="inline-block text-xs text-[#b79bff] underline"
              >Inspect attempts, failures, dead letters and recovery in
              Delivery</NuxtLink
            >
            <p class="break-all font-mono text-[10px] text-[#9AA3B2]">
              Destination ID: {{ item.destination_id }}
            </p>
          </div>
        </article>
      </section>
      <section
        v-if="pending"
        role="dialog"
        aria-modal="false"
        @keydown.esc="pending = null"
        aria-labelledby="integration-confirm-title"
        class="card space-y-3 border-[#5617fc] p-5"
      >
        <h2 id="integration-confirm-title" class="font-semibold">
          Confirm {{ pending.action.replace('_', ' ') }}
        </h2>
        <p class="text-sm text-[#9AA3B2]">{{ confirmationText }}</p>
        <pre
          v-if="pending.action === 'test_send'"
          class="overflow-auto text-xs"
        >
{ "test": true, "message": "Explicit Struct integration test; no customer telemetry" }</pre
        >
        <div class="flex gap-2">
          <button
            class="btn-primary"
            :disabled="busy"
            autofocus
            @click="performConfirmed"
          >
            Confirm {{ pending.action.replace('_', ' ') }}</button
          ><button class="btn-ghost" :disabled="busy" @click="pending = null">
            Cancel
          </button>
        </div>
      </section>
    </template>
  </main>
</template>
<script setup lang="ts">
import {
  INTEGRATION_CATALOG,
  DEFAULT_MAPPING,
  type Integration,
  type IntegrationKind,
} from '#shared/integrations'
definePageMeta({ middleware: 'auth' })
const available = useRuntimeConfig().public.integrationsEnabled,
  { currentOrgId, canWrite, ensureOrganization } = useOrganization()
const integrations = shallowRef<Integration[]>([]),
  health = shallowRef<any>(null),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  selected = ref<string | null>(null),
  step = ref(0),
  rotate = ref(false),
  enableConfirm = ref(false),
  httpHeaders = ref('{}'),
  credentials = ref<Record<string, string>>({}),
  saved = shallowRef<Integration | null>(null)
const recoveryPreview = ref<{ eligible: number; requestId: string } | null>(
  null,
)
const editing = ref<any>(null),
  pending = shallowRef<{ item: Integration; action: string } | null>(null),
  sample = ref('{"temperature":23.5,"humidity":61.25,"is_active":true}'),
  sampleDevice = ref(''),
  sampleSlot = ref(0),
  previewOutput = ref('')
const steps = [
  'Choose provider',
  'Connection and credentials',
  'Routing',
  'Data format',
  'Review',
  'Verify connection',
  'Enable',
]
const provider = computed(
  () =>
    INTEGRATION_CATALOG.find((p) => p.kind === editing.value?.kind) ||
    INTEGRATION_CATALOG[0]!,
)
const review = computed(() =>
  JSON.stringify(
    {
      configuration: editing.value?.config,
      route: editing.value?.route,
      mapping: editing.value?.mapping,
    },
    null,
    2,
  ),
)
const confirmationText = computed(() =>
  pending.value?.action === 'test_send'
    ? 'This sends one synthetic event to the configured destination now, even if the integration is disabled. It can trigger downstream processing.'
    : pending.value?.action === 'remap'
      ? `Retry ${recoveryPreview.value?.eligible || 0} eligible failed deliveries using current mapping version ${pending.value.item.version}. Original event IDs, destination target and routing decision stay unchanged. Duplicate downstream processing is possible.`
      : pending.value?.action === 'delete'
        ? 'Stop future routing and erase stored credentials. History remains; queued work will fail visibly. This cannot be undone.'
        : pending.value?.action === 'enable'
          ? 'Forward new matching telemetry to this destination. Historical events are not backfilled.'
          : 'Stop new routing. Already in-flight requests may finish; queued work may become terminal. Pause instead to retain pending work.',
)
let generation = 0
function message(e: any) {
  return e?.data?.message || e?.message || 'Integration operation failed'
}
async function load() {
  const org = currentOrgId.value,
    version = ++generation
  if (!org) return
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<{ integrations: Integration[]; health: unknown }>(
      '/api/integrations',
      { query: { orgId: org } },
    )
    if (version === generation && currentOrgId.value === org) {
      integrations.value = data.integrations
      health.value = data.health
    }
  } catch (e) {
    if (version === generation) error.value = message(e)
  } finally {
    if (version === generation) loading.value = false
  }
}
function title(kind: IntegrationKind) {
  return INTEGRATION_CATALOG.find((p) => p.kind === kind)?.title || kind
}
function healthFor(id: string) {
  const h = health.value?.destinations?.find((x: any) => x.id === id)
  return h
    ? `${h.backlog || 0} pending · Last success: ${h.last_success ? new Date(h.last_success).toLocaleString() : 'none recorded'} · ${h.failures_24h || 0} failed/unknown attempts in 24h`
    : 'No delivery history yet'
}
function begin(kind: IntegrationKind) {
  error.value = ''
  notice.value = ''
  step.value = 0
  rotate.value = false
  enableConfirm.value = false
  saved.value = null
  credentials.value = {}
  httpHeaders.value = '{}'
  editing.value = {
    kind,
    name: '',
    config: {},
    route: null,
    mapping: structuredClone(DEFAULT_MAPPING),
    version: 0,
    enabled: false,
  }
}
function changeKind() {
  editing.value.config = {}
  credentials.value = {}
}
function edit(item: Integration) {
  begin(item.kind)
  editing.value = {
    id: item.destination_id,
    kind: item.kind,
    name: item.destination.name,
    config: structuredClone(item.config),
    route: structuredClone(item.route),
    mapping: structuredClone(item.mapping),
    version: item.version,
    enabled: item.destination.enabled,
  }
  httpHeaders.value = JSON.stringify(item.config.headers || {})
  step.value = 1
}
function close() {
  editing.value = null
  credentials.value = {}
  rotate.value = false
  enableConfirm.value = false
}
function back() {
  step.value = Math.max(0, step.value - 1)
}
async function next() {
  const org = currentOrgId.value
  if (step.value !== 4) {
    step.value++
    return
  }
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (editing.value.kind === 'http')
      editing.value.config.headers = JSON.parse(httpHeaders.value)
    const result = await $fetch<{ id: string; version: number }>(
      '/api/integrations',
      {
        method: 'POST',
        body: {
          ...editing.value,
          orgId: currentOrgId.value,
          ...(!editing.value.id || rotate.value
            ? {
                credentials: Object.fromEntries(
                  Object.entries(credentials.value).filter(([, v]) => v),
                ),
              }
            : {}),
        },
      },
    )
    if (currentOrgId.value !== org) return
    credentials.value = {}
    await load()
    saved.value =
      integrations.value.find((i) => i.destination_id === result.id) || null
    if (!saved.value) throw new Error('Saved connection could not be reloaded')
    step.value = 5
    notice.value =
      'Configuration saved. New connections remain disabled until enabled.'
  } catch (e) {
    if (currentOrgId.value === org) error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function action(item: Integration, operation: string, confirm = false) {
  if (!item || busy.value) return
  busy.value = true
  notice.value = ''
  error.value = ''
  const org = currentOrgId.value
  try {
    const result = await $fetch<any>('/api/integrations/action', {
      method: 'POST',
      body: {
        orgId: org,
        id: item.destination_id,
        version: item.version,
        action: operation,
        confirm,
        ...(operation === 'remap'
          ? { requestId: recoveryPreview.value?.requestId }
          : {}),
      },
    })
    if (currentOrgId.value !== org) return
    notice.value =
      (operation === 'remap'
        ? `${result.scheduled ?? 0} deliveries queued with the reviewed mapping. This is not delivery confirmation.`
        : result.detail) ||
      {
        enable:
          'Integration enabled. New matching telemetry will be forwarded.',
        disable: 'Integration disabled. New telemetry will not be routed here.',
        pause:
          'Integration paused. Pending work remains within its retention window.',
        resume: 'Integration resumed. Eligible pending work can be delivered.',
        delete:
          'Integration deleted. Credentials were erased; delivery history remains.',
      }[operation] ||
      'Action accepted. Delivery outcomes are recorded separately.'
    await load()
  } catch (e) {
    if (currentOrgId.value === org) error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function confirmAction(item: Integration, operation: string) {
  if (busy.value) return
  const org = currentOrgId.value
  if (operation === 'remap') {
    busy.value = true
    error.value = ''
    const requestId = crypto.randomUUID()
    try {
      const result = await $fetch<{ eligible: number }>(
        '/api/integrations/action',
        {
          method: 'POST',
          body: {
            orgId: org,
            id: item.destination_id,
            version: item.version,
            action: 'preview_remap',
            requestId,
          },
        },
      )
      if (currentOrgId.value !== org) return
      recoveryPreview.value = { eligible: result.eligible, requestId }
    } catch (e) {
      if (currentOrgId.value === org) error.value = message(e)
      return
    } finally {
      busy.value = false
    }
  }
  pending.value = { item, action: operation }
  nextTick(() =>
    document.querySelector<HTMLElement>('[role="dialog"] button')?.focus(),
  )
}
async function performConfirmed() {
  const p = pending.value
  if (!p) return
  await action(p.item, p.action, true)
  pending.value = null
}
async function enableSaved() {
  if (saved.value && enableConfirm.value) {
    await action(saved.value, 'enable', true)
    if (!error.value) close()
  }
}
async function preview(item: Integration) {
  const org = currentOrgId.value
  busy.value = true
  error.value = ''
  try {
    const result = await $fetch('/api/integrations/action', {
      method: 'POST',
      body: {
        orgId: currentOrgId.value,
        id: item.destination_id,
        version: item.version,
        action: 'preview',
        sample: JSON.parse(sample.value),
        deviceId: sampleDevice.value || undefined,
        schemaSlot: sampleSlot.value,
      },
    })
    if (currentOrgId.value === org)
      previewOutput.value = JSON.stringify(result, null, 2)
  } catch (e) {
    if (currentOrgId.value === org) error.value = message(e)
  } finally {
    busy.value = false
  }
}
watch(currentOrgId, () => {
  generation++
  integrations.value = []
  health.value = null
  selected.value = null
  pending.value = null
  notice.value = ''
  previewOutput.value = ''
  recoveryPreview.value = null
  error.value = ''
  close()
  if (available) void load()
})
onMounted(async () => {
  if (available) {
    await ensureOrganization()
    await load()
  }
})
onBeforeUnmount(() => {
  generation++
  credentials.value = {}
})
</script>
