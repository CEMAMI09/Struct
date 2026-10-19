<template>
  <main class="mx-auto max-w-6xl space-y-5">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">Devices</h1>
        <p class="mt-1 text-sm text-[#9AA3B2]">
          Organize, register and provision your fleet.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <NuxtLink to="/docs/fleet-management" class="btn-ghost text-xs"
          >Fleet guide</NuxtLink
        ><button
          v-if="canWrite"
          class="btn-primary text-xs"
          @click="openCreate"
        >
          Add devices
        </button>
      </div>
    </header>
    <p
      v-if="error"
      role="alert"
      class="card border-red-900 p-3 text-sm text-red-300"
    >
      {{ error }}
      <NuxtLink to="/dashboard/settings?tab=billing" class="underline"
        >Account and billing</NuxtLink
      >
    </p>
    <p v-if="notice" role="status" class="card p-3 text-sm text-[#b79bff]">
      {{ notice }}
    </p>
    <section class="card space-y-3 p-4" aria-label="Device filters">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label class="label"
          >Search<input
            v-model="search"
            class="input mt-1"
            placeholder="Name, UUID, wire ID, serial or external ID"
        /></label>
        <label class="label"
          >Activity / authorization<select
            v-model="status"
            aria-label="Activity / authorization"
            class="input mt-1"
          >
            <option value="">All devices</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="never">Never connected</option>
            <option value="disabled">Disabled</option>
            <option value="revoked">Revoked</option>
            <option value="deleted">Archived</option>
          </select></label
        >
        <label class="label"
          >Group<select v-model="group" aria-label="Group" class="input mt-1">
            <option value="">All groups</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">
              {{ g.name }} ({{ g.count }})
            </option>
          </select></label
        >
        <label class="label"
          >Sort<select v-model="sort" aria-label="Sort" class="input mt-1">
            <option value="created">Recently created</option>
            <option value="name">Name</option>
            <option value="seen">Last seen</option>
          </select></label
        >
      </div>
      <details class="text-xs text-[#9AA3B2]">
        <summary class="cursor-pointer">Tags and schema filters</summary>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label class="label"
            >Tags (all must match)<input
              v-model="tagFilter"
              class="input mt-1"
              placeholder="outdoor, production"
              list="fleet-tags"
          /></label>
          <label class="label"
            >Schema source device UUID<input
              v-model="schemaDevice"
              class="input mt-1"
              placeholder="Optional: match its published schema"
          /></label>
          <label class="label"
            >Schema slot<input
              v-model.number="schemaSlot"
              type="number"
              min="0"
              max="15"
              class="input mt-1"
          /></label>
        </div>
      </details>
      <details class="text-xs text-[#9AA3B2]">
        <summary class="cursor-pointer">Created / last-seen dates</summary>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label v-for="item in dateFields" :key="item.key" class="label">
            {{ item.label }}
            <input
              v-model="dates[item.key]"
              :aria-label="item.label"
              type="datetime-local"
              class="input mt-1"
            />
          </label>
        </div>
      </details>
      <datalist id="fleet-tags">
        <option v-for="t in tags" :key="t.label" :value="t.label">
          {{ t.count }} devices
        </option>
      </datalist>
      <details class="text-xs text-[#9AA3B2]">
        <summary class="cursor-pointer">What do these statuses mean?</summary>
        <p class="mt-2">
          Active means telemetry was recently observed, not a continuous UDP
          connection. Inactive means prior activity is outside three expected
          reporting intervals (minimum five minutes). Disabled is reversible.
          Revoked and archived devices cannot be re-enabled. Retention does not
          erase first-packet evidence.
        </p>
      </details>
    </section>
    <section
      v-if="selected.length || allMatching"
      class="card flex flex-wrap items-center gap-3 border-[#5617fc] p-3"
      aria-label="Bulk actions"
    >
      <span class="text-sm"
        >{{ allMatching ? total : selected.length }} selected</span
      ><button class="btn-ghost text-xs" @click="clearSelection">Clear</button
      ><button
        v-if="!allMatching && total > devices.length"
        class="btn-ghost text-xs"
        @click="selectMatching"
      >
        Select all {{ total }} matching
      </button>
      <template v-if="canWrite"
        ><select
          v-model="operation"
          class="input w-auto"
          aria-label="Bulk operation"
        >
          <option value="disable">Disable</option>
          <option value="enable">Enable</option>
          <option value="groups_add">Assign groups</option>
          <option value="groups_remove">Remove groups</option>
          <option value="labels_add">Add tags</option>
          <option value="labels_remove">Remove tags</option>
          <option value="metadata">Update metadata</option>
          <option v-if="can('devices.export_credentials')" value="reprovision">
            Reprovision credentials
          </option>
          <option v-if="can('devices.revoke')" value="revoke">Revoke</option>
          <option v-if="can('devices.delete')" value="delete">
            Archive
          </option></select
        ><button
          class="btn-primary text-xs"
          :disabled="busy"
          @click="openAction"
        >
          Configure and preview
        </button></template
      >
      <button
        class="btn-ghost text-xs"
        :disabled="busy"
        @click="exportInventory"
      >
        Export metadata
      </button>
    </section>
    <section
      class="card overflow-hidden"
      aria-label="Device inventory"
      :aria-busy="loading"
    >
      <div class="flex items-center justify-between p-4 text-sm">
        <span
          >{{ total.toLocaleString() }} devices
          <span v-if="loading" class="text-[#9AA3B2]">· Loading…</span></span
        ><button class="btn-ghost text-xs" :disabled="loading" @click="load">
          Refresh
        </button>
      </div>
      <div
        class="overflow-x-auto"
        tabindex="0"
        aria-label="Device inventory columns"
      >
        <table class="w-full text-left text-sm">
          <thead class="border-y border-[#2A2F3A] text-xs text-[#9AA3B2]">
            <tr>
              <th class="p-3">
                <input
                  type="checkbox"
                  aria-label="Select current page"
                  :checked="
                    devices.length > 0 &&
                    devices.every((d) => selected.includes(d.id))
                  "
                  @change="togglePage"
                />
              </th>
              <th class="p-3">Device</th>
              <th class="p-3">Status</th>
              <th class="p-3">Groups / tags</th>
              <th class="p-3">Last activity</th>
              <th class="p-3">Provisioning</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="d in devices"
              :key="d.id"
              class="border-b border-[#2A2F3A]"
            >
              <td class="p-3">
                <input
                  v-model="selected"
                  type="checkbox"
                  :value="d.id"
                  :aria-label="`Select ${d.name}`"
                  :disabled="allMatching"
                />
              </td>
              <td class="p-3">
                <NuxtLink
                  :to="`/dashboard?device=${d.id}`"
                  class="text-[#b79bff] hover:underline"
                  >{{ d.name }}</NuxtLink
                >
                <p class="mt-1 text-xs text-[#9AA3B2]">
                  {{ d.external_id || d.serial_number || d.id }}
                </p>
                <NuxtLink
                  :to="`/dashboard/getting-started?device=${d.id}`"
                  class="text-xs text-[#9AA3B2] underline"
                  >Setup / SDK</NuxtLink
                >
              </td>
              <td class="p-3 whitespace-nowrap">{{ activity(d.activity) }}</td>
              <td class="p-3">
                <p>{{ d.groups.map((g) => g.name).join(', ') || '—' }}</p>
                <p class="mt-1 text-xs text-[#9AA3B2]">
                  {{ d.labels.join(', ') }}
                </p>
              </td>
              <td class="p-3 whitespace-nowrap text-xs">
                {{ date(d.last_seen) }}
              </td>
              <td class="p-3 text-xs">
                {{
                  d.credential_epoch_first_seen_at
                    ? 'Current credentials verified by telemetry'
                    : d.provisioning_exported_at
                      ? 'Manifest exported · device update unverified'
                      : 'Registered'
                }}
              </td>
            </tr>
            <tr v-if="!devices.length && !loading">
              <td colspan="6" class="p-8 text-center text-[#9AA3B2]">
                No devices match. Create devices or adjust your filters.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between p-3 text-xs">
        <button
          class="btn-ghost"
          :disabled="page === 0 || loading"
          @click="previousPage"
        >
          Previous</button
        ><span>Page {{ page + 1 }} · 50 per page</span
        ><button
          class="btn-ghost"
          :disabled="(page + 1) * 50 >= total || loading"
          @click="nextPage"
        >
          Next
        </button>
      </div>
    </section>

    <section
      v-if="editor"
      class="card space-y-4 p-4"
      aria-label="Bulk configuration"
    >
      <div class="flex justify-between">
        <h2 class="font-semibold">
          {{
            editor === 'create' ? 'Register devices' : 'Configure bulk action'
          }}
        </h2>
        <button class="btn-ghost text-xs" @click="closeEditor">Close</button>
      </div>
      <template v-if="editor === 'create'">
        <label class="label"
          >Input method<select
            v-model="method"
            aria-label="Input method"
            class="input mt-1"
          >
            <option value="quantity">Quantity and numbering</option>
            <option value="list">Paste device names</option>
            <option value="csv">Import CSV</option>
          </select></label
        >
        <div v-if="method === 'quantity'" class="grid gap-3 sm:grid-cols-4">
          <label class="label"
            >Name prefix<input v-model="prefix" class="input mt-1" /></label
          ><label class="label"
            >Quantity<input
              v-model.number="quantity"
              type="number"
              min="1"
              max="10000"
              class="input mt-1" /></label
          ><label class="label"
            >Starting number<input
              v-model.number="start"
              type="number"
              min="0"
              class="input mt-1" /></label
          ><label class="label"
            >Number digits<input
              v-model.number="digits"
              type="number"
              min="1"
              max="10"
              class="input mt-1"
          /></label>
        </div>
        <label v-if="method === 'list'" class="label"
          >One name per line<textarea
            v-model="names"
            class="input mt-1 min-h-28"
          />
        </label>
        <div v-if="method === 'csv'" class="space-y-3">
          <label class="label"
            >UTF-8 CSV (4 MiB / 10,000 rows maximum)<input
              type="file"
              accept=".csv,text/csv"
              class="input mt-1"
              @change="readCsv"
          /></label>
          <p class="text-xs text-[#9AA3B2]">
            Credentials are never imported. Metadata uses a JSON object. Quoted
            commas and Unicode are supported.
          </p>
          <div v-if="headers.length" class="grid gap-2 sm:grid-cols-2">
            <label v-for="h in headers" :key="h" class="label"
              >{{ h }} →<select
                v-model="mapping[h]"
                :aria-label="`${h} →`"
                class="input"
              >
                <option value="">Ignore column</option>
                <option v-for="f in CSV_FIELDS" :key="f" :value="f">
                  {{ f }}
                </option>
              </select></label
            >
          </div>
          <p v-if="csvPreview" class="text-xs">{{ csvPreview }}</p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="label"
            >Copy schema from device (optional UUID)<input
              v-model="sourceDevice"
              class="input mt-1"
              placeholder="Authorized source device UUID" /></label
          ><label class="label"
            >Published slot<input
              v-model.number="sourceSlot"
              type="number"
              min="0"
              max="15"
              class="input mt-1"
          /></label>
        </div>
        <label class="label"
          >Existing external/serial identity<select
            v-model="duplicates"
            aria-label="Existing external/serial identity"
            class="input mt-1"
          >
            <option value="reject">Reject duplicate items</option>
            <option value="skip">Skip existing devices</option>
            <option value="metadata">Update description / metadata only</option>
          </select></label
        >
      </template>
      <div
        v-if="editor === 'create' || operation.startsWith('groups_')"
        class="space-y-2"
      >
        <p class="label">Groups</p>
        <label
          v-for="g in groups"
          :key="g.id"
          class="mr-4 inline-flex items-center gap-2 text-sm"
          ><input v-model="actionGroups" type="checkbox" :value="g.id" />{{
            g.name
          }}</label
        >
      </div>
      <label
        v-if="editor === 'create' || operation.startsWith('labels_')"
        class="label"
        >Tags<input
          v-model="actionTags"
          class="input mt-1"
          placeholder="production, outdoor"
      /></label>
      <template v-if="editor !== 'create' && operation === 'metadata'"
        ><label class="label"
          >Description<input
            v-model="description"
            class="input mt-1"
            maxlength="1000" /></label
        ><label class="label"
          >Metadata JSON (replaces existing metadata)<textarea
            v-model="metadata"
            class="input mt-1 font-mono"
          /></label
      ></template>
      <p
        v-if="editor !== 'create' && operation === 'reprovision'"
        class="text-sm text-amber-200"
      >
        Manual reprovisioning immediately revokes old credentials and allocates
        a new wire ID. Offline devices need a new SDK configuration. This does
        not remotely update firmware.
      </p>
      <p
        v-if="editor !== 'create' && operation === 'delete'"
        class="text-sm text-amber-200"
      >
        Archive blocks ingestion and preserves telemetry/delivery history.
        Archived devices still count under existing billing rules.
      </p>
      <button class="btn-primary text-sm" :disabled="busy" @click="preview">
        Validate and preview
      </button>
    </section>
    <section class="card space-y-3 p-4" aria-label="Device groups">
      <h2 class="font-semibold">Groups</h2>
      <p class="text-xs text-[#9AA3B2]">
        Multiple memberships, flat groups. Deleting a group preserves its
        devices and stops future group matches.
      </p>
      <form
        v-if="canWrite"
        class="flex flex-wrap gap-2"
        @submit.prevent="saveGroup"
      >
        <input
          v-model="groupName"
          class="input max-w-sm"
          aria-label="Group name"
          placeholder="Factory A"
          maxlength="100"
        /><button
          class="btn-ghost text-xs"
          :disabled="busy || !groupName.trim()"
        >
          {{ editingGroup ? 'Save group' : 'Create group' }}</button
        ><button
          v-if="editingGroup"
          type="button"
          class="btn-ghost text-xs"
          @click="cancelGroup"
        >
          Cancel edit
        </button>
      </form>
      <ul class="space-y-2">
        <li
          v-for="g in groups"
          :key="g.id"
          class="flex flex-wrap items-center justify-between gap-2 text-sm"
        >
          <span
            >{{ g.name }} · {{ g.count }} devices
            <span class="font-mono text-xs text-[#9AA3B2]">{{
              g.id
            }}</span></span
          >
          <div v-if="canWrite" class="flex gap-2">
            <button class="btn-ghost text-xs" @click="editGroup(g)">
              Rename</button
            ><button
              class="btn-ghost text-xs text-red-300"
              @click="deleteGroup(g)"
            >
              Delete group
            </button>
          </div>
        </li>
      </ul>
    </section>
    <section class="card space-y-3 p-4" aria-label="Bulk jobs">
      <h2 class="font-semibold">Bulk jobs</h2>
      <p class="text-xs text-[#9AA3B2]">
        Jobs continue on the server. Canceling stops remaining items; committed
        changes remain. Refresh is automatic while work is running.
      </p>
      <button
        v-for="j in jobs"
        :key="j.id"
        class="flex w-full flex-wrap justify-between gap-2 rounded border border-[#2A2F3A] p-3 text-left text-sm"
        @click="openJob(j.id)"
      >
        <span>{{ j.operation }} · {{ date(j.created_at) }}</span
        ><span>{{ j.status.replaceAll('_', ' ') }}</span>
      </button>
    </section>
    <section v-if="job" class="card space-y-4 p-4" aria-label="Job details">
      <div class="flex flex-wrap justify-between gap-2">
        <div>
          <h2 class="font-semibold">
            {{ job.operation }} · {{ job.status.replaceAll('_', ' ') }}
          </h2>
          <p class="mt-1 text-xs font-mono text-[#9AA3B2]">{{ job.id }}</p>
        </div>
        <button class="btn-ghost text-xs" @click="closeJob">
          Close details
        </button>
      </div>
      <p class="text-sm">
        {{
          Object.entries(counts)
            .map(([k, v]) => `${v} ${k}`)
            .join(' · ')
        }}
      </p>
      <p v-if="job.options?.billingPreview" class="text-xs text-[#9AA3B2]">
        Upper-bound fleet size: {{ job.options.billingPreview.projected }}.
        Estimated month-end true-up:
        {{ job.options.billingPreview.estimatedTrueUpCents / 100 }}
        {{ job.options.billingPreview.currency }}. Existing billing terms apply;
        skipped rows may reduce this estimate.
      </p>
      <p v-if="job.status === 'ready'" class="text-sm text-amber-200">
        Review these exact items before confirming. Preview expires
        {{ date(job.expires_at) }}. Revoke and reprovision actions invalidate
        current credentials. Updates change server records; they do not apply
        physical-device settings.
      </p>
      <label v-if="job.status === 'ready'" class="flex gap-2 text-sm"
        ><input v-model="confirmed" type="checkbox" />I reviewed the selected
        devices, billing implications and action consequences.</label
      >
      <p v-if="job.options?.review" class="text-sm">
        Preview: {{ job.options.review.total }} rows,
        {{ job.options.review.existing }} existing identities, up to
        {{ job.options.review.createsUpperBound }} new devices.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="counts.failed"
          class="btn-ghost text-xs"
          :disabled="busy"
          @click="retryFailed"
        >
          Preview retry of eligible failures
        </button>
        <button
          v-if="job.status === 'ready'"
          class="btn-primary text-sm"
          :disabled="busy || !confirmed"
          @click="jobAction('confirm')"
        >
          Confirm operation</button
        ><button
          v-if="['ready', 'pending', 'running'].includes(job.status)"
          class="btn-ghost text-xs"
          :disabled="busy"
          @click="jobAction('cancel')"
        >
          Cancel remaining items</button
        ><button class="btn-ghost text-xs" :disabled="busy" @click="exportJob">
          Download result report</button
        ><button
          v-if="
            can('devices.export_credentials') &&
            ['create', 'reprovision'].includes(job.operation)
          "
          class="btn-ghost text-xs"
          :disabled="busy"
          @click="manifest"
        >
          Download private manifest for this result page
        </button>
      </div>
      <p
        v-if="
          can('devices.export_credentials') &&
          ['create', 'reprovision'].includes(job.operation)
        "
        class="text-xs text-[#9AA3B2]"
      >
        Manifest: one-time disclosure per credential epoch, at most 100 devices.
        Contains secrets. Store securely offline. A lost download requires
        authorized per-device SDK retrieval or reprovisioning.
      </p>
      <div
        class="max-h-[60vh] overflow-auto"
        tabindex="0"
        aria-label="Job result rows"
      >
        <table class="w-full text-left text-xs">
          <thead>
            <tr>
              <th class="p-2">Row</th>
              <th class="p-2">Device / proposed name</th>
              <th class="p-2">Result</th>
              <th class="p-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="i in items"
              :key="i.item_index"
              class="border-t border-[#2A2F3A]"
            >
              <td class="p-2">{{ i.item_index + 1 }}</td>
              <td class="p-2">{{ i.input.name || i.device_id }}</td>
              <td class="p-2">{{ i.status }}</td>
              <td class="p-2">{{ i.error_code || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex justify-between">
        <button
          class="btn-ghost text-xs"
          :disabled="jobPage === 0"
          @click="previousResults"
        >
          Previous results</button
        ><span class="text-xs">Results page {{ jobPage + 1 }}</span
        ><button
          class="btn-ghost text-xs"
          :disabled="items.length < 100"
          @click="nextResults"
        >
          Next results
        </button>
      </div>
    </section>
  </main>
</template>
<script setup lang="ts">
import {
  CSV_FIELDS,
  csvRows,
  parseCsv,
  labels,
  csvExport,
  fleetPreviewIntent,
  manifestDeviceIds,
  type FleetDevice,
  type FleetGroup,
  type FleetItem,
  type FleetJob,
  type FleetOperation,
} from '#shared/fleet'
const { currentOrgId, canWrite, can, ensureOrganization } = useOrganization()
const route = useRoute()
const devices = shallowRef<FleetDevice[]>([]),
  groups = shallowRef<FleetGroup[]>([]),
  jobs = shallowRef<FleetJob[]>([]),
  tags = shallowRef<{ label: string; count: number }[]>([])
const total = ref(0),
  page = ref(0),
  search = ref(''),
  status = ref(''),
  group = ref(''),
  sort = ref('created'),
  tagFilter = ref(''),
  schemaDevice = ref(''),
  schemaSlot = ref(0)
const selected = ref<string[]>([]),
  selectedVersions = ref<Record<string, number>>({}),
  allMatching = ref(false),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
const dateFields = [
  { key: 'createdAfter', label: 'Created after' },
  { key: 'createdBefore', label: 'Created before' },
  { key: 'seenAfter', label: 'Last seen after' },
  { key: 'seenBefore', label: 'Last seen before' },
] as const
const dates = reactive<Record<string, string>>({})
const editor = ref(''),
  operation = ref<FleetOperation>('disable'),
  method = ref('quantity'),
  prefix = ref('sensor-'),
  quantity = ref(1),
  start = ref(1),
  digits = ref(3),
  names = ref(''),
  csv = ref(''),
  headers = ref<string[]>([]),
  mapping = ref<Record<string, string>>({}),
  duplicates = ref('reject'),
  sourceDevice = ref(''),
  sourceSlot = ref(0),
  actionGroups = ref<string[]>([]),
  actionTags = ref(''),
  description = ref(''),
  metadata = ref('{}')
const groupName = ref(''),
  editingGroup = ref<FleetGroup | null>(null),
  job = shallowRef<(FleetJob & { options?: any }) | null>(null),
  items = shallowRef<FleetItem[]>([]),
  counts = ref<Record<string, number>>({}),
  jobPage = ref(0),
  confirmed = ref(false)
let generation = 0,
  jobGeneration = 0,
  filterTimer: ReturnType<typeof setTimeout> | undefined,
  poll: ReturnType<typeof setInterval> | undefined
const csvPreview = computed(() => {
  if (!csv.value) return ''
  try {
    const rows = csvRows(
      csv.value,
      Object.fromEntries(Object.entries(mapping.value).filter(([, v]) => v)),
    )
    const errors = rows.filter((r) => r.error)
    return `${rows.length} rows · ${rows.length - errors.length} valid · ${errors.length} invalid${errors.length ? ` · row ${errors[0]!.row}: ${errors[0]!.error}` : ''}`
  } catch (e) {
    return (e as Error).message
  }
})
function filter() {
  return {
    search: search.value,
    status: status.value,
    group: group.value,
    sort: sort.value,
    labels: labels(tagFilter.value),
    ...Object.fromEntries(
      Object.entries(dates)
        .filter(([, value]) => value)
        .map(([key, value]) => [key, new Date(value).toISOString()]),
    ),
    ...(schemaDevice.value
      ? { schemaDevice: schemaDevice.value, schemaSlot: schemaSlot.value }
      : {}),
  }
}
function message(e: any) {
  return e?.data?.message || e?.message || 'Unable to complete this action.'
}
function date(v: string | null) {
  return v ? new Date(v).toLocaleString() : '—'
}
function activity(v: string) {
  return (
    (
      {
        never: 'Never connected',
        active: 'Active',
        inactive: 'Inactive',
        disabled: 'Disabled',
        revoked: 'Revoked',
        deleted: 'Archived',
      } as Record<string, string>
    )[v] || v
  )
}
function clearSelection() {
  selected.value = []
  selectedVersions.value = {}
  allMatching.value = false
}
async function load() {
  const org = currentOrgId.value,
    version = ++generation
  if (!org) return
  loading.value = true
  try {
    const r = await $fetch<any>('/api/fleet', {
      query: { orgId: org, page: page.value, filter: JSON.stringify(filter()) },
    })
    if (version !== generation || org !== currentOrgId.value) return
    devices.value = r.devices
    groups.value = r.groups
    jobs.value = r.jobs
    tags.value = r.tags
    total.value = r.total
    for (const d of devices.value)
      if (
        selected.value.includes(d.id) &&
        selectedVersions.value[d.id] === undefined
      )
        selectedVersions.value[d.id] = d.admin_version
  } catch (e) {
    if (version === generation) error.value = message(e)
  } finally {
    if (version === generation) loading.value = false
  }
}
function togglePage(e: Event) {
  if ((e.target as HTMLInputElement).checked) {
    for (const d of devices.value) {
      if (!selected.value.includes(d.id)) selected.value.push(d.id)
      selectedVersions.value[d.id] = d.admin_version
    }
  } else {
    selected.value = selected.value.filter(
      (id) => !devices.value.some((d) => d.id === id),
    )
  }
  allMatching.value = false
}
function selectMatching() {
  allMatching.value = true
  selected.value = []
}
function previousPage() {
  page.value--
  void load()
}
function nextPage() {
  page.value++
  void load()
}
function openCreate() {
  editor.value = 'create'
  closeJob()
  error.value = ''
}
function openAction() {
  editor.value = 'action'
  job.value = null
  error.value = ''
}
function closeEditor() {
  editor.value = ''
}
async function readCsv(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('CSV exceeds 4 MiB')
    const text = await file.text()
    const parsed = parseCsv(text)
    headers.value = parsed[0]!
    mapping.value = Object.fromEntries(
      headers.value.map((h) => [h, CSV_FIELDS.includes(h as any) ? h : '']),
    )
    csv.value = text
  } catch (e) {
    error.value = message(e)
    csv.value = ''
    headers.value = []
  }
}
async function mutate<T>(fn: (org: string) => Promise<T>) {
  const org = currentOrgId.value
  if (!org || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await fn(org)
    if (org !== currentOrgId.value) return
    return result
  } catch (e) {
    if (org === currentOrgId.value) error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function preview() {
  const id = await mutate(async (org) => {
    const options: any = {
      groups: actionGroups.value,
      labels: labels(actionTags.value),
    }
    let request: any = {
      orgId: org,
      operation: editor.value === 'create' ? 'create' : operation.value,
      options,
    }
    if (editor.value === 'create') {
      if (sourceDevice.value) {
        options.sourceDevice = sourceDevice.value
        options.sourceSlot = sourceSlot.value
      }
      request.duplicates = duplicates.value
      if (method.value === 'quantity')
        Object.assign(request, {
          prefix: prefix.value,
          quantity: quantity.value,
          start: start.value,
          digits: digits.value,
        })
      else if (method.value === 'list')
        request.rows = names.value
          .split(/\r?\n/)
          .filter((v) => v.trim())
          .map((name) => ({ name }))
      else
        Object.assign(request, {
          csv: csv.value,
          mapping: Object.fromEntries(
            Object.entries(mapping.value).filter(([, v]) => v),
          ),
        })
    } else {
      if (operation.value === 'metadata') {
        options.description = description.value
        options.metadata = JSON.parse(metadata.value)
      }
      if (allMatching.value) request.filter = filter()
      else
        request.rows = selected.value.map((id) => ({
          id,
          version:
            selectedVersions.value[id] ??
            devices.value.find((d) => d.id === id)?.admin_version,
        }))
    }
    const cacheKey = `struct-fleet-preview:${org}`
    let previous = null
    try {
      previous = JSON.parse(sessionStorage.getItem(cacheKey) || 'null')
    } catch {}
    const intent = await fleetPreviewIntent(request, previous)
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(intent))
    } catch {}
    request.requestId = intent.requestId
    const result = (
      await $fetch<{ jobId: string }>('/api/fleet/preview', {
        method: 'POST',
        body: request,
      })
    ).jobId
    try {
      sessionStorage.removeItem(cacheKey)
    } catch {}
    return result
  })
  if (id) {
    editor.value = ''
    await openJob(id)
    await load()
  }
}
async function openJob(id: string) {
  jobPage.value = 0
  confirmed.value = false
  await loadJob(id)
}
async function loadJob(id = job.value?.id) {
  const org = currentOrgId.value
  if (!id || !org) return
  const version = ++jobGeneration
  try {
    const r = await $fetch<any>('/api/fleet/job', {
      query: { orgId: org, id, page: jobPage.value },
    })
    if (org !== currentOrgId.value || version !== jobGeneration) return
    job.value = r.job
    items.value = r.items
    counts.value = r.counts
  } catch (e) {
    if (org === currentOrgId.value && version === jobGeneration)
      error.value = message(e)
  }
}
function closeJob() {
  jobGeneration++
  job.value = null
  items.value = []
  counts.value = {}
}
async function previousResults() {
  jobPage.value--
  await loadJob()
}
async function nextResults() {
  jobPage.value++
  await loadJob()
}
async function retryFailed() {
  const id = job.value?.id
  if (!id) return
  const r = await mutate((org) =>
    $fetch<{ jobId: string }>('/api/fleet/action', {
      method: 'POST',
      body: {
        orgId: org,
        jobId: id,
        action: 'retry_preview',
        requestId: crypto.randomUUID(),
      },
    }),
  )
  if (r?.jobId) {
    await openJob(r.jobId)
    await load()
  }
}
async function jobAction(action: string) {
  const id = job.value?.id
  if (!id) return
  await mutate((org) =>
    $fetch('/api/fleet/action', {
      method: 'POST',
      body: { orgId: org, jobId: id, action },
    }),
  )
  clearSelection()
  await loadJob(id)
  await load()
}
function editGroup(g: FleetGroup) {
  editingGroup.value = g
  groupName.value = g.name
}
function cancelGroup() {
  editingGroup.value = null
  groupName.value = ''
}
async function saveGroup() {
  const result = await mutate((org) =>
    $fetch('/api/fleet/groups', {
      method: 'POST',
      body: {
        orgId: org,
        name: groupName.value,
        id: editingGroup.value?.id,
        version: editingGroup.value?.version,
      },
    }),
  )
  if (result) {
    cancelGroup()
    await load()
  }
}
async function deleteGroup(g: FleetGroup) {
  if (
    !window.confirm(
      `Delete group ${g.name}? Devices are preserved. Future routing to this group will stop.`,
    )
  )
    return
  await mutate((org) =>
    $fetch('/api/fleet/groups', {
      method: 'POST',
      body: {
        orgId: org,
        name: g.name,
        id: g.id,
        version: g.version,
        delete: true,
      },
    }),
  )
  await load()
}
function download(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function exportInventory() {
  await mutate(async (org) => {
    const r = await $fetch<string>('/api/fleet/export', {
      method: 'POST',
      body: {
        orgId: org,
        filter: allMatching.value ? filter() : undefined,
        ids: allMatching.value ? undefined : selected.value,
      },
    })
    if (org === currentOrgId.value) download('struct-device-metadata.csv', r)
  })
}
async function exportJob() {
  await mutate(async (org) => {
    const r = await $fetch<string>('/api/fleet/export', {
      method: 'POST',
      body: { orgId: org, jobId: job.value?.id },
    })
    if (org === currentOrgId.value) download('struct-job-results.csv', r)
  })
}
async function manifest() {
  const ids = job.value
    ? manifestDeviceIds(job.value.operation, items.value)
    : []
  if (!ids.length) {
    error.value = 'No eligible completed devices on this page.'
    return
  }
  if (
    !window.confirm(
      `Download private credentials for ${ids.length} devices? This is a one-time disclosure. Store the file offline securely. Firmware is not automatically updated.`,
    )
  )
    return
  await mutate(async (org) => {
    const r = await $fetch('/api/fleet/manifest', {
      method: 'POST',
      body: { orgId: org, jobId: job.value?.id, deviceIds: ids, confirm: true },
    })
    if (org !== currentOrgId.value) return
    download(
      'struct-private-provisioning.json',
      JSON.stringify(r, null, 2),
      'application/json',
    )
  })
}
watch(
  [search, status, group, sort, tagFilter, schemaDevice, schemaSlot],
  () => {
    clearTimeout(filterTimer)
    clearSelection()
    page.value = 0
    filterTimer = setTimeout(() => void load(), 250)
  },
)
watch(dates, () => {
  clearTimeout(filterTimer)
  clearSelection()
  page.value = 0
  filterTimer = setTimeout(() => void load(), 250)
})
watch(
  selected,
  () => {
    for (const id of selected.value)
      if (selectedVersions.value[id] === undefined) {
        const d = devices.value.find((d) => d.id === id)
        if (d) selectedVersions.value[id] = d.admin_version
      }
  },
  { deep: true },
)
watch(currentOrgId, () => {
  generation++
  devices.value = []
  groups.value = []
  tags.value = []
  jobs.value = []
  total.value = 0
  clearSelection()
  closeJob()
  closeEditor()
  csv.value = ''
  headers.value = []
  mapping.value = {}
  sourceDevice.value = ''
  schemaDevice.value = ''
  actionGroups.value = []
  actionTags.value = ''
  group.value = ''
  tagFilter.value = ''
  groupName.value = ''
  editingGroup.value = null
  error.value = ''
  notice.value = ''
  page.value = 0
  void load()
})
onMounted(async () => {
  await ensureOrganization()
  await load()
  if (route.query.create === '1' && canWrite.value) openCreate()
  poll = setInterval(() => {
    if (
      document.visibilityState === 'visible' &&
      ((job.value && ['pending', 'running'].includes(job.value.status)) ||
        jobs.value.some((j) => ['pending', 'running'].includes(j.status)))
    ) {
      void loadJob()
      void load()
    }
  }, 3000)
})
onBeforeUnmount(() => {
  generation++
  jobGeneration++
  clearTimeout(filterTimer)
  clearInterval(poll)
})
</script>
