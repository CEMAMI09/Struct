<template>
  <div class="mx-auto max-w-7xl space-y-5">
    <header class="flex flex-wrap justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">
          {{
            mode === 'monitoring'
              ? 'Fleet monitoring'
              : mode === 'analytics'
                ? 'Usage analytics'
                : 'Alerts'
          }}
        </h1>
        <p class="mt-1 text-sm text-[#9AA3B2]">
          Observed reporting and traffic, with explicit measurement limits.
        </p>
      </div>
      <NuxtLink to="/docs/monitoring-analytics" class="btn-ghost"
        >View guide</NuxtLink
      >
    </header>
    <nav aria-label="Monitoring sections" class="flex gap-3 text-sm">
      <NuxtLink
        v-for="m in ['monitoring', 'analytics', 'alerts']"
        :key="m"
        :to="'/dashboard/' + m"
        class="text-[#b79bff]"
        :aria-current="mode === m ? 'page' : undefined"
        >{{ m }}</NuxtLink
      >
    </nav>
    <p
      v-if="error"
      role="alert"
      class="rounded border border-red-400/30 p-3 text-red-300"
    >
      {{ error }}
    </p>
    <p v-if="loading && !overview" role="status">
      Loading workspace measurements…
    </p>
    <details class="card p-4">
      <summary class="cursor-pointer text-sm font-medium">
        Filters and display settings
      </summary>
      <div class="mt-4 grid gap-3 md:grid-cols-4">
        <label class="label"
          >Device ID (optional)<input
            v-model="device"
            class="input"
            placeholder="UUID"
            @change="filterChanged"
        /></label>
        <label class="label"
          >Group<select v-model="group" class="input" @change="filterChanged">
            <option value="">All groups</option>
            <option v-for="g in overview?.groups" :key="g.id" :value="g.id">
              {{ g.name }}
            </option>
          </select></label
        >
        <label class="label"
          >Tag<input
            v-model="tag"
            class="input"
            placeholder="Exact tag"
            @change="filterChanged"
        /></label>
        <label class="label"
          >Time zone<input
            v-model="timezone"
            class="input"
            placeholder="UTC"
            @change="validateTimezone"
        /></label>
        <template v-if="mode === 'analytics'"
          ><label class="label"
            >Time range<select
              v-model="range"
              class="input"
              @change="refresh()"
            >
              <option value="1">Last hour</option>
              <option value="24">Last 24 hours</option>
              <option value="168">Last 7 days</option>
              <option value="720">Last 30 days</option>
              <option value="month">Calendar month (UTC)</option>
              <option value="custom">Custom</option>
            </select></label
          ><label v-if="range === 'custom'" class="label"
            >From (UTC)<input
              v-model="customFrom"
              type="datetime-local"
              class="input"
              @change="refresh()" /></label
          ><label v-if="range === 'custom'" class="label"
            >To (UTC)<input
              v-model="customTo"
              type="datetime-local"
              class="input"
              @change="refresh()" /></label
        ></template>
        <button class="btn-ghost self-end" :disabled="loading" @click="refresh">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </details>
    <template v-if="overview && !error">
      <p class="text-xs text-[#9AA3B2]">
        Activity is observed telemetry, not a continuously open connection.
        Updated {{ date(overview.updatedAt) }}. Usage aggregation may lag;
        {{ usage?.gaps ?? 'unavailable' }} recorded coverage gaps in the
        selected window; {{ usage?.pending ?? 'unavailable' }} pending metric
        events.
      </p>
      <div
        v-if="mode === 'monitoring'"
        class="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <div v-for="(v, k) in overview.counts" :key="k" class="card p-4">
          <p class="text-xs text-[#9AA3B2]">{{ status(k) }}</p>
          <strong class="text-2xl">{{ formatCount(v) }}</strong>
        </div>
        <NuxtLink to="/dashboard/alerts" class="card p-4"
          ><p class="text-xs text-[#9AA3B2]">Active incidents</p>
          <strong class="text-2xl">{{
            overview.activeAlerts
          }}</strong></NuxtLink
        >
      </div>
      <UsageChart
        v-if="mode === 'monitoring'"
        :buckets="overview.healthHistory || []"
        title="Workspace reporting snapshots"
        metric="reporting"
        note="Hourly observed fleet state; workspace-wide, independent of current group/device filter. No historical reconstruction."
        :timezone="timezone"
      />
      <UsageChart
        v-if="mode === 'monitoring' && usage"
        :buckets="usage.buckets"
        title="Accepted logical readings"
        metric="readings"
        note="Aggregated commits; retransmissions do not add readings."
        :timezone="timezone"
      />
      <section
        v-if="mode === 'monitoring'"
        class="card p-4"
        aria-label="Device health inventory"
      >
        <div class="flex flex-wrap gap-3">
          <h2 class="font-semibold">Device health · {{ overview.total }}</h2>
          <label class="text-xs"
            >Attention<select
              v-model="attention"
              class="input"
              @change="filterChanged"
            >
              <option value="">All devices</option>
              <option value="errors">Observed authenticated rejections</option>
              <option value="alerts">Device-scoped incidents</option>
            </select></label
          >
          <label class="text-xs"
            >Status<select
              v-model="state"
              class="input"
              @change="filterChanged"
            >
              <option value="">All</option>
              <option
                v-for="s in [
                  'reporting',
                  'inactive',
                  'never',
                  'no_expectation',
                  'disabled',
                  'revoked',
                ]"
                :key="s"
                :value="s"
              >
                {{ status(s) }}
              </option>
            </select></label
          >
        </div>
        <div
          class="mt-3 overflow-x-auto"
          tabindex="0"
          aria-label="Scrollable device health table"
        >
          <table class="w-full min-w-[650px] text-left text-sm">
            <thead>
              <tr>
                <th>Device</th>
                <th>Activity</th>
                <th>Last successful monitored commit</th>
                <th>Expectation</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in overview.devices"
                :key="d.id"
                class="border-t border-white/10"
              >
                <td class="py-3">
                  {{ d.name }}
                  <p
                    v-if="d.observed_rejections !== '0'"
                    class="text-xs text-amber-300"
                  >
                    {{ d.observed_rejections }} observed authenticated
                    rejections / 24h
                  </p>
                  <NuxtLink
                    v-if="d.device_alerts !== '0'"
                    :to="'/dashboard/alerts?device=' + d.id"
                    class="text-xs text-[#b79bff]"
                    >{{ d.device_alerts }} device-scoped incidents</NuxtLink
                  >
                </td>
                <td>{{ status(d.status) }}</td>
                <td>{{ date(d.last_monitored_commit_at) }}</td>
                <td>
                  {{
                    d.mode === 'scheduled'
                      ? d.interval_seconds +
                        's + ' +
                        d.grace_seconds +
                        's grace'
                      : d.mode === 'event'
                        ? 'Event-driven'
                        : 'No expectation'
                  }}
                </td>
                <td>
                  <button class="text-[#b79bff]" @click="inspect(d)">
                    Health / policy
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!overview.devices.length" class="py-4 text-sm">
          No devices match this view.
        </p>
        <div class="mt-3 flex gap-3">
          <button
            class="btn-ghost"
            :disabled="page === 0"
            @click="changePage(-1)"
          >
            Previous</button
          ><span class="self-center text-xs">Page {{ page + 1 }}</span
          ><button
            class="btn-ghost"
            :disabled="(page + 1) * 50 >= Number(overview.total)"
            @click="changePage(1)"
          >
            Next
          </button>
        </div>
      </section>
      <section
        v-if="selected && mode === 'monitoring'"
        class="card space-y-3 p-4"
        aria-label="Device monitoring policy"
      >
        <h2 class="font-semibold">{{ selected.name }} · monitoring policy</h2>
        <p class="break-all text-xs">
          {{ selected.id }} · last successful monitored commit
          {{ date(selected.last_monitored_commit_at) }}
          · last observed immutable slot
          {{ selected.last_monitored_schema_slot ?? 'Unavailable' }}
        </p>
        <div class="grid gap-3 md:grid-cols-4">
          <label class="label"
            >Reporting mode<select v-model="policy.mode" class="input">
              <option value="scheduled">Scheduled</option>
              <option value="event">Event-driven</option>
              <option value="none">No expectation</option>
            </select></label
          ><label class="label"
            >Interval (seconds)<input
              v-model.number="policy.interval"
              type="number"
              min="1"
              max="604800"
              class="input" /></label
          ><label class="label"
            >Grace (seconds)<input
              v-model.number="policy.grace"
              type="number"
              min="0"
              max="604800"
              class="input" /></label
          ><label class="label"
            >Suspend until (UTC)<input
              v-model="policy.maintenance"
              type="datetime-local"
              class="input"
          /></label>
        </div>
        <button
          v-if="canWrite"
          class="btn-primary"
          :disabled="busy"
          @click="savePolicy"
        >
          Save device policy</button
        ><NuxtLink
          :to="'/dashboard/analytics?device=' + selected.id"
          class="ml-3 text-[#b79bff]"
          >View device usage</NuxtLink
        ><NuxtLink
          :to="'/dashboard/debugger?device=' + selected.id"
          class="ml-3 text-[#b79bff]"
          >Packet diagnostics</NuxtLink
        >
      </section>
      <details v-if="mode === 'monitoring' && canWrite" class="card p-4">
        <summary class="cursor-pointer font-semibold">
          Workspace monitoring defaults and maintenance
        </summary>
        <div class="mt-3 grid gap-3 md:grid-cols-4">
          <label class="label"
            >Default mode<select v-model="preferences.mode" class="input">
              <option value="none">No expectation</option>
              <option value="scheduled">Scheduled</option>
              <option value="event">Event-driven</option>
            </select></label
          ><label class="label"
            >Default interval (seconds)<input
              v-model.number="preferences.interval"
              type="number"
              class="input" /></label
          ><label class="label"
            >Default grace (seconds)<input
              v-model.number="preferences.grace"
              type="number"
              class="input" /></label
          ><label class="label"
            >Workspace maintenance until (UTC)<input
              v-model="preferences.maintenance"
              type="datetime-local"
              class="input"
          /></label>
        </div>
        <button
          class="btn-primary mt-3"
          :disabled="busy"
          @click="savePreferences"
        >
          Save workspace defaults
        </button>
      </details>
      <section v-if="mode === 'monitoring'" class="card p-4">
        <h2 class="font-semibold">Downstream delivery</h2>
        <p class="mt-2 text-sm">
          {{ overview.delivery.pending }} queued ·
          {{ overview.delivery.sending }} sending ·
          {{ overview.delivery.dead }} dead-lettered
        </p>
        <p class="mt-1 text-xs text-[#9AA3B2]">
          Independent of device receipt guarantees. Oldest queued:
          {{ date(overview.delivery.oldest) }}
        </p>
        <NuxtLink to="/dashboard/deliveries" class="text-sm text-[#b79bff]"
          >Investigate deliveries</NuxtLink
        >
      </section>
      <template v-if="mode === 'analytics' && usage">
        <div class="grid gap-3 md:grid-cols-4">
          <div class="card p-4">
            <p class="text-xs">Observed application uplink</p>
            <strong>{{
              totals.applicationAvailable
                ? formatBytes(totals.application)
                : 'Unavailable'
            }}</strong>
          </div>
          <div class="card p-4">
            <p class="text-xs">Accepted logical readings</p>
            <strong>{{
              totals.available ? formatCount(totals.readings) : 'Unavailable'
            }}</strong>
          </div>
          <div class="card p-4">
            <p class="text-xs">Calculated UDP/IP exchange</p>
            <strong>{{
              totals.networkAvailable && usage.gaps === '0'
                ? formatBytes(totals.network)
                : 'Incomplete measurement'
            }}</strong>
          </div>
          <div class="card p-4">
            <p class="text-xs">Carrier-billed usage</p>
            <strong>Unavailable</strong>
          </div>
        </div>
        <p class="text-xs text-[#9AA3B2]">
          {{ usage.measurement }}. Window aligns to
          {{ usage.grain }} boundaries. Last aggregation:
          {{ date(usage.updatedAt) }}. Retention:
          {{ usage.retentionDays }} days; byte capture began
          {{ date(usage.coverageStart) }}.
          {{
            usage.windowComplete
              ? ''
              : 'This window includes unavailable history; network-based cost projections are disabled.'
          }}
        </p>
        <UsageChart
          :buckets="usage.buckets"
          title="Observed application traffic"
          metric="application"
          note="Existing UTC buckets; latest 240 shown. Chart heights are approximate, labels preserve exact counters."
          :timezone="timezone"
        />
        <details class="card p-4" open>
          <summary class="cursor-pointer font-semibold">
            Packet composition and batch accounting
          </summary>
          <div
            v-if="totals.applicationAvailable && totals.application > 0n"
            class="mt-3 flex h-8 overflow-hidden rounded"
            aria-label="Observed application byte composition"
          >
            <button
              v-for="part in packetParts"
              :key="part.name"
              :style="{
                width:
                  Number((part.bytes * 10000n) / totals.application) / 100 +
                  '%',
                background: part.color,
              }"
              :title="part.name + ': ' + formatBytes(part.bytes)"
              :aria-label="part.name + ': ' + formatBytes(part.bytes)"
              @click="packetNote = part.name + ': ' + formatBytes(part.bytes)"
            ></button>
          </div>
          <p class="mt-1 text-xs text-[#9AA3B2]" role="status">
            {{
              packetNote ||
              'Tap a segment to inspect its observed byte component.'
            }}
          </p>
          <div class="mt-3 grid gap-3 text-sm md:grid-cols-3">
            <p>
              Committed sensor payload:
              {{
                totals.applicationAvailable
                  ? formatBytes(totals.payload)
                  : 'Unavailable'
              }}
            </p>
            <p>
              Committed framing:
              {{
                totals.applicationAvailable
                  ? formatBytes(totals.framing)
                  : 'Unavailable'
              }}
            </p>
            <p>
              Committed AEAD tags:
              {{
                totals.applicationAvailable
                  ? formatBytes(totals.security)
                  : 'Unavailable'
              }}
            </p>
            <p>
              Other observed uplink:
              {{
                formatBytes(
                  totals.application -
                    totals.payload -
                    totals.framing -
                    totals.security,
                )
              }}
            </p>
            <p>
              Observed socket-submitted receipts:
              {{ formatBytes(totals.receipts) }}
            </p>
            <p>
              Observed authenticated duplicates:
              {{ formatCount(totals.duplicates) }}
            </p>
            <p>
              Observed authenticated rejections:
              {{ formatCount(totals.rejected) }}
            </p>
            <p>
              Bytes/readings ratio:
              {{
                totals.readings > 0n && totals.unknown === 0n
                  ? ratio(totals.application, totals.readings) +
                    ' B (includes received retries)'
                  : 'Unavailable'
              }}
            </p>
            <p>
              Average readings per committed datagram:
              {{
                totals.unknown === 0n
                  ? ratio(totals.readings, totals.committed_packets)
                  : 'Unavailable'
              }}
            </p>
            <p>
              Unknown historical byte records: {{ formatCount(totals.unknown) }}
            </p>
          </div>
          <p class="mt-3 text-xs text-[#9AA3B2]">
            A batch is one packet with several readings. Duplicate/rejected
            bytes lack a trusted decoded payload breakdown. Socket submission
            does not prove a device received the receipt.
          </p>
        </details>
        <section class="card p-4">
          <div class="flex flex-wrap justify-between gap-2">
            <h2 class="font-semibold">Highest observed usage</h2>
            <button class="btn-ghost" @click="exportUsage">
              Download usage JSON
            </button>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <h3 class="my-2 text-sm">Devices</h3>
              <p
                v-for="d in usage.devices"
                :key="d.device_id"
                class="flex justify-between gap-3 py-1 text-sm"
              >
                <button
                  class="text-[#b79bff]"
                  @click="chooseDevice(d.device_id)"
                >
                  {{ d.name || d.device_id }}</button
                ><span>{{ formatBytes(d.application) }}</span>
              </p>
            </div>
            <div>
              <h3 class="my-2 text-sm">Groups</h3>
              <p
                v-for="g in usage.groups"
                :key="g.group_id"
                class="flex justify-between gap-3 py-1 text-sm"
              >
                <button class="text-[#b79bff]" @click="chooseGroup(g.group_id)">
                  {{ g.name || g.group_id }}</button
                ><span>{{ formatBytes(g.application) }}</span>
              </p>
              <p class="mt-2 text-xs">
                Multiple memberships overlap; group totals are not additive.
              </p>
            </div>
          </div>
        </section>
        <section class="card p-4" aria-label="Efficiency insights">
          <h2 class="font-semibold">Efficiency and protocol reference</h2>
          <p class="mt-2 text-sm text-[#9AA3B2]">
            Select a device to inspect its latest retained reading and actual
            immutable schema. This sample does not represent an entire fleet.
          </p>
          <button
            class="btn-ghost mt-3"
            :disabled="!device || busy"
            @click="loadSample"
          >
            Inspect latest device sample</button
          ><template v-if="sample"
            ><p class="mt-2 text-sm">
              {{ sample.reason || sample.sample?.scope }}
            </p>
            <div
              v-for="insight in sample.insights || []"
              :key="insight.kind"
              class="mt-3 rounded border border-white/10 p-3 text-sm"
            >
              <p v-if="insight.kind === 'batch'">
                {{ insight.recordBytes }} B/reading in this schema.
                {{ insight.batch }}-reading hypothetical batch:
                {{ insight.applicationPerReading }} application B/reading;
                single reading {{ insight.singleApplicationBytes }} B.
              </p>
              <p v-else>
                Lossless schema packing: {{ insight.originalPayloadBytes }} B →
                {{ insight.candidatePayloadBytes }} B payload ({{
                  insight.savings
                }}
                B difference).
              </p>
              <p class="mt-1 text-xs text-[#9AA3B2]">
                {{ insight.evidence }} {{ insight.tradeoffs }}
              </p>
            </div>
            <div v-if="sample.comparison" class="mt-3 overflow-x-auto">
              <p class="text-xs">
                Latest reading only; competitors preserve the declared
                precision. Security/delivery differences and modeled components
                remain disclosed.
              </p>
              <div
                v-for="r in sample.comparison.results"
                :key="r.id"
                class="mt-2 border-t border-white/10 py-2 text-sm"
              >
                <strong>{{ r.name }}</strong> · {{ r.profile }}
                <p>
                  Application uplink
                  {{ r.metrics.applicationUp?.value ?? 'Unavailable' }} B ({{
                    r.metrics.applicationUp?.evidence
                  }})
                </p>
                <details>
                  <summary class="cursor-pointer text-[#b79bff]">
                    Configuration, evidence and caveats
                  </summary>
                  <p>{{ r.metrics.applicationUp?.note }}</p>
                  <p v-for="n in r.notes" :key="n">{{ n }}</p>
                  <p>{{ r.implementation }}</p>
                  <p>References: {{ r.sources?.join(', ') }}</p>
                </details>
              </div>
            </div></template
          ><NuxtLink to="/benchmarks" class="ml-3 text-sm text-[#b79bff]"
            >Open full Protocol Lab</NuxtLink
          >
        </section>
        <details class="card p-4" aria-label="Connectivity cost model">
          <summary class="cursor-pointer font-semibold">
            Optional connectivity cost estimate
          </summary>
          <p class="mt-2 text-xs text-[#9AA3B2]">
            Customer assumptions, not carrier measurement. Price is
            intentionally unset. Carrier override already includes cellular
            traffic; network projection uses the cellular fraction.
          </p>
          <div class="mt-3 grid gap-3 md:grid-cols-3">
            <label class="label"
              >Cost per decimal MB<input
                v-model="cost.pricePerMB"
                class="input"
                placeholder="Your price" /></label
            ><label class="label"
              >Currency<input
                v-model="cost.currency"
                maxlength="8"
                class="input" /></label
            ><label class="label"
              >Cellular percentage<input
                v-model.number="cost.cellularPercent"
                type="number"
                min="0"
                max="100"
                class="input" /></label
            ><label class="label"
              >Days per billing period<input
                v-model.number="cost.billingDays"
                type="number"
                min="1"
                max="366"
                class="input" /></label
            ><label class="label"
              >Billing<select v-model="cost.metered" class="input">
                <option :value="true">Metered</option>
                <option :value="false">Flat rate</option>
              </select></label
            ><label class="label"
              >Monthly minimum / flat fee<input
                v-model="cost.monthlyMinimum"
                class="input" /></label
            ><label class="label"
              >Included allowance (MB)<input
                v-model="cost.allowanceMB"
                class="input" /></label
            ><label class="label"
              >Fleet-level rounding increment (MB)<input
                v-model="cost.incrementMB"
                class="input" /></label
            ><label class="label"
              >Measured carrier bytes/period (optional)<input
                v-model="cost.carrierMonthlyBytes"
                class="input" /></label
            ><label class="label"
              >Measured baseline bytes/period (optional)<input
                v-model="cost.baselineMonthlyBytes"
                class="input"
            /></label>
          </div>
          <p role="status" class="mt-3 text-sm">
            {{ costResult.error || costResult.reason }}
          </p>
          <div v-if="costResult.available" class="mt-3 text-sm">
            <p>
              Projected billing period:
              {{ formatBytes(costResult.monthlyBytes!) }} · {{ cost.currency }}
              {{ costResult.monthlyCost }}
            </p>
            <p>
              Annualized: {{ formatBytes(costResult.annualBytes!) }} ·
              {{ cost.currency }} {{ costResult.annualCost }}
            </p>
            <p>
              {{ costResult.differenceLabel
              }}{{
                costResult.difference === null
                  ? ''
                  : ': ' + cost.currency + ' ' + costResult.difference
              }}
            </p>
            <p class="mt-2 text-xs text-[#9AA3B2]">
              {{ costResult.source }}. {{ costResult.note }}
            </p>
          </div>
          <button
            v-if="canWrite"
            class="btn-ghost mt-3"
            :disabled="busy"
            @click="savePreferences"
          >
            Save cost assumptions and time zone
          </button>
        </details>
      </template>
      <template v-if="mode === 'alerts'">
        <section class="card p-4" aria-label="Alert incidents">
          <h2 class="font-semibold">
            Incidents · {{ overview.activeAlerts }} active
          </h2>
          <label class="label mt-2"
            >Incident view<select
              v-model="incidentState"
              class="input max-w-xs"
              @change="resetIncidentPage"
            >
              <option value="active">Active</option>
              <option value="history">Resolved history</option>
              <option value="all">All</option>
            </select></label
          >
          <div class="mt-2 flex gap-2">
            <button
              class="btn-ghost"
              :disabled="incidentPage === 0"
              @click="changeIncidentPage(-1)"
            >
              Newer incidents</button
            ><button
              class="btn-ghost"
              :disabled="overview.incidents.length < 50"
              @click="changeIncidentPage(1)"
            >
              Older incidents
            </button>
          </div>
          <p v-if="!overview.incidents.length" class="mt-3 text-sm">
            No incidents recorded. Rules are disabled by default.
          </p>
          <article
            v-for="i in overview.incidents"
            :key="i.id"
            class="mt-3 rounded border border-white/10 p-3"
          >
            <div class="flex flex-wrap justify-between gap-2">
              <strong>{{ i.rule_name }}</strong
              ><span class="text-xs">{{ i.severity }} · {{ i.status }}</span>
            </div>
            <p class="mt-1 text-sm">{{ i.reason }}</p>
            <p
              v-if="i.notification_suppressed_reason"
              class="mt-1 text-xs text-amber-300"
            >
              Notification suppressed: {{ i.notification_suppressed_reason }}
            </p>
            <p class="mt-1 text-xs text-[#9AA3B2]">
              Opened {{ date(i.opened_at) }} · {{ i.id }}
            </p>
            <div
              v-if="can('alerts.acknowledge') && i.status !== 'resolved'"
              class="mt-2 flex gap-2"
            >
              <button
                class="btn-ghost"
                :disabled="busy || i.status === 'acknowledged'"
                @click="act('acknowledge', { id: i.id })"
              >
                Acknowledge</button
              ><button
                class="btn-ghost"
                :disabled="busy"
                v-if="can('alerts.manage')"
                @click="resolve(i.id)"
              >
                Resolve manually
              </button>
            </div>
          </article>
        </section>
        <section class="card p-4" aria-label="Alert rules">
          <div class="flex justify-between">
            <h2 class="font-semibold">Rules</h2>
            <button v-if="canWrite" class="btn-primary" @click="editRule()">
              Add rule
            </button>
          </div>
          <article
            v-for="r in overview.rules"
            :key="r.id"
            class="mt-3 border-t border-white/10 pt-3"
          >
            <strong>{{ r.name }}</strong>
            <p class="text-xs text-[#9AA3B2]">
              {{ r.kind }} · {{ r.enabled ? 'Enabled' : 'Disabled' }} ·
              threshold {{ r.threshold }}, clear {{ r.clear_threshold }} · last
              evaluated {{ date(r.last_evaluated_at) }} · last value
              {{ r.last_value ?? 'Unavailable' }}
            </p>
            <p v-if="r.last_evaluation_error" class="text-xs text-amber-300">
              Evaluation note: {{ r.last_evaluation_error }}
            </p>
            <div v-if="canWrite" class="mt-2 flex flex-wrap gap-2">
              <button class="btn-ghost" @click="editRule(r)">Edit</button
              ><button
                class="btn-ghost"
                :disabled="busy"
                @click="act('toggle', { id: r.id, enabled: !r.enabled })"
              >
                {{ r.enabled ? 'Disable' : 'Enable' }}</button
              ><button
                class="btn-ghost"
                :disabled="busy"
                @click="
                  act('mute', {
                    id: r.id,
                    until: new Date(Date.now() + 3600000).toISOString(),
                  })
                "
              >
                Mute for 1 hour</button
              ><button class="btn-ghost text-red-300" @click="deleteRule(r.id)">
                Delete
              </button>
            </div>
          </article>
        </section>
        <section
          v-if="editing && canWrite"
          class="card space-y-3 p-4"
          aria-label="Rule editor"
        >
          <h2 class="font-semibold">
            {{ rule.version ? 'Edit rule' : 'New rule' }}
          </h2>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="label"
              >Rule name<input
                v-model="rule.name"
                maxlength="120"
                class="input" /></label
            ><label class="label"
              >Condition<select v-model="rule.kind" class="input">
                <option v-for="k in RULE_KINDS" :key="k" :value="k">
                  {{ k }}
                </option>
              </select></label
            ><label class="label"
              >Severity<select v-model="rule.severity" class="input">
                <option>info</option>
                <option>warning</option>
                <option>critical</option>
              </select></label
            ><label class="label"
              >Trigger threshold<input
                v-model="rule.threshold"
                class="input" /></label
            ><label class="label"
              >Clear threshold (hysteresis)<input
                v-model="rule.clear"
                class="input" /></label
            ><label class="label"
              >Comparison<select v-model="rule.comparator" class="input">
                <option value="gte">At least</option>
                <option value="lte">At most</option>
              </select></label
            ><label class="label"
              >Window (minutes)<input
                v-model.number="rule.window"
                type="number"
                min="1"
                max="10080"
                class="input" /></label
            ><label class="label"
              >Minimum condition/recovery duration (seconds)<input
                v-model.number="rule.hold"
                type="number"
                min="0"
                class="input" /></label
            ><label class="label"
              >Reopen cooldown (seconds)<input
                v-model.number="rule.cooldown"
                type="number"
                min="60"
                class="input" /></label
            ><label class="label"
              >Device ID (optional)<input
                v-model="rule.device"
                class="input" /></label
            ><label class="label"
              >Group scope<select v-model="rule.group" class="input">
                <option value="">Entire workspace</option>
                <option v-for="g in overview.groups" :key="g.id" :value="g.id">
                  {{ g.name }}
                </option>
              </select></label
            ><label class="label"
              >Tag scope<input v-model="rule.tag" class="input" /></label
            ><label v-if="rule.kind === 'sensor'" class="label"
              >Numeric telemetry field<input
                v-model="rule.field"
                class="input" /></label
            ><label class="label"
              >Webhook notification<select v-model="rule.webhook" class="input">
                <option value="">Dashboard only</option>
                <option
                  v-for="d in overview.destinations"
                  :key="d.id"
                  :value="d.id"
                >
                  {{ d.name }}
                </option>
              </select></label
            ><label class="flex items-center gap-2 text-sm"
              ><input v-model="rule.email" type="checkbox" />Notify opted-in
              workspace members by email</label
            ><label class="flex items-center gap-2 text-sm"
              ><input v-model="rule.enabled" type="checkbox" />Enable automatic
              evaluation</label
            >
          </div>
          <p class="text-xs text-[#9AA3B2]">
            Inactivity thresholds count scheduled devices; never-connected
            windows use registration age; bytes count observed application
            uplink; rejection/delivery thresholds use percentages; queue age
            uses seconds. Sensor conditions use recent numeric samples only. No
            raw secrets are included.
          </p>
          <button class="btn-primary" :disabled="busy" @click="saveRule">
            Save rule</button
          ><button class="btn-ghost ml-3" @click="editing = false">
            Cancel
          </button>
        </section>
        <section class="card p-4">
          <h2 class="font-semibold">Your email preferences</h2>
          <p class="mt-1 text-xs text-[#9AA3B2]">
            Only your verified account email can receive notifications. Requires
            operator-configured Resend credentials. Provider acceptance does not
            prove inbox delivery.
          </p>
          <label class="mt-3 flex gap-2 text-sm"
            ><input v-model="email.enabled" type="checkbox" />Email me when
            configured rules trigger or recover</label
          ><label class="label mt-2"
            >Minimum severity<select
              v-model="email.severity"
              class="input max-w-xs"
            >
              <option>info</option>
              <option>warning</option>
              <option>critical</option>
            </select></label
          ><button
            class="btn-primary mt-3"
            :disabled="busy"
            @click="act('email_preferences', email)"
          >
            Save email preferences
          </button>
        </section>
        <details class="card p-4">
          <summary class="cursor-pointer font-semibold">
            Notification and incident history
          </summary>
          <p
            v-for="n in overview.notifications"
            :key="n.id"
            class="mt-2 text-xs"
          >
            {{ date(n.created_at) }} · {{ n.channel }} · {{ n.status }} ·
            {{ n.attempts }} email attempts ·
            {{ n.error_category || 'No recorded error' }} · incident
            {{ n.incident_id }}
          </p>
          <p
            v-for="(t, i) in overview.transitions"
            :key="i"
            class="mt-2 text-xs"
          >
            {{ date(t.at) }} · {{ t.state }} · {{ t.incident_id }}
          </p>
        </details>
      </template>
    </template>
  </div>
</template>
<script setup lang="ts">
import {
  RULE_KINDS,
  usageTotals,
  formatBytes,
  formatCount,
  ratio,
  estimateCost,
  defaultCost,
  type OverviewResponse,
  type UsageResponse,
  type MonitoringDevice,
  type AlertRule,
  type CostResult,
} from '#shared/observability'
const props = defineProps<{ mode: 'monitoring' | 'analytics' | 'alerts' }>(),
  route = useRoute(),
  { currentOrgId, ensureOrganization, canWrite, can } = useOrganization()
const overview = ref<OverviewResponse | null>(null),
  usage = ref<UsageResponse | null>(null),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  page = ref(0),
  device = ref(
    typeof route.query.device === 'string' ? route.query.device : '',
  ),
  group = ref(''),
  tag = ref(''),
  state = ref(''),
  attention = ref(''),
  timezone = ref('UTC'),
  range = ref('24'),
  customFrom = ref(''),
  customTo = ref(''),
  sample = ref<any>(null),
  selected = ref<MonitoringDevice | null>(null)
const cost = reactive({ ...defaultCost }),
  preferences = reactive({
    mode: 'none',
    interval: 300,
    grace: 300,
    maintenance: '',
  }),
  policy = reactive({
    mode: 'none',
    interval: 300,
    grace: 300,
    maintenance: '',
  }),
  email = reactive({ enabled: false, severity: 'warning' })
const blankRule = () => ({
  id: crypto.randomUUID(),
  version: 0,
  name: '',
  kind: 'inactivity',
  threshold: '1',
  clear: '0',
  window: 60,
  hold: 0,
  cooldown: 300,
  severity: 'warning',
  enabled: false,
  email: false,
  webhook: '',
  device: '',
  group: '',
  tag: '',
  field: '',
  comparator: 'gte',
  description: '',
})
const incidentState = ref('active'),
  incidentPage = ref(0)
const rule = reactive(blankRule()),
  editing = ref(false),
  totals = computed(() => usageTotals(usage.value?.buckets || []))
const packetNote = ref('')
const packetParts = computed(() =>
  [
    {
      name: 'Committed sensor payload',
      bytes: totals.value.payload,
      color: '#793cff',
    },
    {
      name: 'Committed framing',
      bytes: totals.value.framing,
      color: '#6b7280',
    },
    {
      name: 'Committed security tags',
      bytes: totals.value.security,
      color: '#22a699',
    },
    {
      name: 'Other received traffic (duplicates/rejections)',
      bytes:
        totals.value.application -
        totals.value.payload -
        totals.value.framing -
        totals.value.security,
      color: '#c79c3d',
    },
  ].filter((p) => p.bytes > 0n),
)
function exportUsage() {
  if (!usage.value) return
  const blob = new Blob(
      [
        JSON.stringify(
          {
            workspace: currentOrgId.value,
            device: device.value,
            group: group.value,
            tag: tag.value,
            measurement: usage.value.measurement,
            usage: usage.value,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = 'struct-usage.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
let generation = 0,
  timer: ReturnType<typeof setInterval> | undefined,
  initialized = ''
function status(s: string | number) {
  return (
    (
      {
        reporting: 'Recently reporting',
        inactive: 'Inactive',
        never: 'Never connected',
        no_expectation: 'No scheduled expectation',
        disabled: 'Disabled',
        revoked: 'Revoked',
        unavailable: 'Commit activity unavailable',
      } as Record<string, string>
    )[s] || s
  )
}
function date(s: string | null) {
  return s
    ? new Date(s).toLocaleString(undefined, { timeZone: timezone.value })
    : 'Unavailable'
}
function validateTimezone() {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone.value })
    error.value = ''
  } catch {
    timezone.value = 'UTC'
    error.value = 'Enter a valid IANA time zone.'
  }
}
function windowRange() {
  const to =
    range.value === 'custom' ? Date.parse(customTo.value + 'Z') : Date.now()
  const from =
    range.value === 'custom'
      ? Date.parse(customFrom.value + 'Z')
      : range.value === 'month'
        ? Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
        : to - Number(range.value) * 3600000
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}
function filterChanged() {
  page.value = 0
  incidentPage.value = 0
  void refresh()
}
function changeIncidentPage(delta: number) {
  incidentPage.value += delta
  void refresh()
}
function resetIncidentPage() {
  incidentPage.value = 0
  void refresh()
}
function changePage(delta: number) {
  page.value += delta
  void refresh()
}
function chooseDevice(id: string) {
  device.value = id
  filterChanged()
}
function chooseGroup(id: string) {
  group.value = id
  filterChanged()
}
async function refresh() {
  const org = currentOrgId.value
  if (!org) return
  const g = ++generation
  loading.value = true
  error.value = ''
  try {
    const filter = JSON.stringify({
      ...(device.value ? { device: device.value } : {}),
      ...(group.value ? { group: group.value } : {}),
      ...(tag.value ? { tag: tag.value } : {}),
      ...(state.value ? { status: state.value } : {}),
      ...(attention.value ? { view: attention.value } : {}),
      incidentState: incidentState.value,
      incidentPage: incidentPage.value,
    })
    const win = windowRange()
    const [o, u] = await Promise.all([
      $fetch<OverviewResponse>('/api/observability', {
        query: { orgId: org, filter, page: page.value },
      }),
      $fetch<UsageResponse>('/api/observability/usage', {
        query: { orgId: org, filter, ...win },
      }),
    ])
    if (g !== generation || org !== currentOrgId.value) return
    overview.value = o
    usage.value = u
    if (initialized !== org) {
      initialized = org
      const p = o.preferences
      timezone.value = p?.timezone || 'UTC'
      Object.assign(preferences, {
        mode: p?.default_mode || 'none',
        interval: p?.interval_seconds || 300,
        grace: p?.grace_seconds ?? 300,
        maintenance: p?.maintenance_until?.slice(0, 16) || '',
      })
      Object.assign(cost, defaultCost)
      for (const k of Object.keys(
        defaultCost,
      ) as (keyof typeof defaultCost)[]) {
        const v = p?.cost?.[k]
        if (typeof v === typeof defaultCost[k]) (cost as any)[k] = v
      }
      Object.assign(
        email,
        o.emailPreferences || { enabled: false, severity: 'warning' },
      )
    }
  } catch (e: any) {
    if (g === generation)
      error.value = e?.data?.message || e.message || 'Monitoring unavailable.'
  } finally {
    if (g === generation) loading.value = false
  }
}
async function act(action: string, data: unknown) {
  if (busy.value) return
  const org = currentOrgId.value
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/observability/action', {
      method: 'POST',
      body: { orgId: org, action, data },
    })
    if (org === currentOrgId.value) await refresh()
  } catch (e: any) {
    if (org === currentOrgId.value) error.value = e?.data?.message || e.message
  } finally {
    busy.value = false
  }
}
function inspect(d: MonitoringDevice) {
  selected.value = d
  Object.assign(policy, {
    mode: d.mode,
    interval: d.interval_seconds,
    grace: d.grace_seconds,
    maintenance: d.maintenance_until?.slice(0, 16) || '',
  })
}
async function savePolicy() {
  await act('policy', {
    device: selected.value?.id,
    ...policy,
    maintenance: policy.maintenance
      ? new Date(policy.maintenance + 'Z').toISOString()
      : null,
  })
}
async function savePreferences() {
  validateTimezone()
  if (error.value) return
  await act('preferences', {
    ...preferences,
    maintenance: preferences.maintenance
      ? new Date(preferences.maintenance + 'Z').toISOString()
      : null,
    timezone: timezone.value,
    cost: { ...cost },
  })
}
function editRule(r?: AlertRule) {
  Object.assign(
    rule,
    blankRule(),
    r
      ? {
          ...r,
          device: r.device_id || '',
          group: r.group_id || '',
          webhook: r.webhook_id || '',
          field: r.field || '',
          tag: r.tag || '',
          threshold: String(r.threshold),
          clear: String(r.clear_threshold),
          window: r.window_minutes,
          hold: r.hold_seconds,
          cooldown: r.cooldown_seconds,
        }
      : {},
  )
  editing.value = true
}
async function saveRule() {
  const data: any = { ...rule }
  for (const k of ['id', 'device', 'group', 'webhook', 'tag', 'field'])
    if (!data[k]) delete data[k]
  await act('rule', data)
  if (!error.value) editing.value = false
}
async function deleteRule(id: string) {
  if (
    confirm(
      'Delete this rule? Active incidents will be resolved and history retained.',
    )
  )
    await act('delete_rule', { id })
}
async function resolve(id: string) {
  if (
    confirm(
      'Resolve manually? An ongoing condition may reopen after cooldown. Acknowledgment does not resolve an incident.',
    )
  )
    await act('resolve', { id })
}
async function loadSample() {
  if (busy.value) return
  const org = currentOrgId.value,
    g = generation
  busy.value = true
  try {
    const r = await $fetch('/api/observability/sample', {
      query: { orgId: org, device: device.value },
    })
    if (org === currentOrgId.value && g === generation) sample.value = r
  } catch (e: any) {
    error.value = e?.data?.message || e.message
  } finally {
    busy.value = false
  }
}
const costResult = computed<CostResult>(() => {
  try {
    return {
      ...estimateCost(
        totals.value.networkAvailable &&
          usage.value?.gaps === '0' &&
          usage.value?.windowComplete
          ? totals.value.network
          : null,
        usage.value
          ? (Date.parse(usage.value.to) - Date.parse(usage.value.from)) / 1000
          : 0,
        cost,
      ),
      error: '',
    }
  } catch (e: any) {
    return { available: false, error: e.message }
  }
})
watch(currentOrgId, () => {
  generation++
  overview.value = null
  usage.value = null
  selected.value = null
  sample.value = null
  if (initialized) device.value = ''
  group.value = ''
  tag.value = ''
  state.value = ''
  attention.value = ''
  page.value = 0
  incidentPage.value = 0
  editing.value = false
  Object.assign(cost, defaultCost)
  if (currentOrgId.value) void refresh()
})
onMounted(async () => {
  await ensureOrganization()
  await refresh()
  timer = setInterval(() => {
    if (!document.hidden && !busy.value && !loading.value) void refresh()
  }, 30000)
})
onBeforeUnmount(() => {
  generation++
  clearInterval(timer)
})
</script>
