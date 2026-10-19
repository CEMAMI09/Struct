<template>
  <div class="mx-auto max-w-6xl space-y-5">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">
          {{
            mode === 'security'
              ? 'Workspace security'
              : mode === 'operations'
                ? 'Operations'
                : 'Organization & team'
          }}
        </h1>
        <p class="mt-2 text-sm text-[#9AA3B2]">
          Shared resources, explicit permissions and recorded administrative
          actions.
        </p>
      </div>
      <NuxtLink class="btn-ghost" to="/docs/enterprise">View guide</NuxtLink>
    </header>
    <nav
      class="flex flex-wrap gap-4 text-sm text-[#b79bff]"
      aria-label="Enterprise settings"
    >
      <NuxtLink to="/dashboard/organization">Team</NuxtLink
      ><NuxtLink to="/dashboard/security">Security & API keys</NuxtLink
      ><NuxtLink v-if="can('audit.read')" to="/dashboard/audit-logs"
        >Audit history</NuxtLink
      ><NuxtLink v-if="can('operations.read')" to="/dashboard/operations"
        >Operations</NuxtLink
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
      Loading authorized workspace information…
    </p>
    <div
      v-if="secret"
      class="card space-y-3 border-purple-400/50 p-4"
      role="region"
      aria-label="One-time sensitive information"
    >
      <h2 class="font-semibold">{{ secretTitle }}</h2>
      <p class="text-sm">
        Copy this now. It is not stored in browser settings or returned by
        ordinary lists. Share invitation links only with the intended recipient;
        store API credentials in your secret manager.
      </p>
      <code class="block break-all rounded bg-black p-3 text-xs">{{
        secret
      }}</code
      ><button class="btn-primary" @click="copySecret">
        {{ copied ? 'Copied' : 'Copy securely' }}</button
      ><button class="btn-ghost ml-2" @click="clearSecret">Hide</button>
    </div>
    <template v-if="overview">
      <section class="card p-4">
        <h2 class="font-semibold">{{ overview.organization.name }}</h2>
        <p class="mt-2 text-sm">
          Your role: <strong class="capitalize">{{ overview.role }}</strong
          >. {{ ROLE_DESCRIPTIONS[overview.role as EnterpriseRole] }}
        </p>
        <p class="mt-2 text-xs text-[#9AA3B2]">
          Removing a membership does not delete this workspace’s devices,
          telemetry or delivery work. Authorization is checked on every
          protected operation.
        </p>
      </section>
      <template v-if="mode === 'team'">
        <details class="card p-4">
          <summary class="cursor-pointer text-sm">
            Create another workspace
          </summary>
          <form
            class="mt-3 flex flex-wrap items-end gap-3"
            @submit.prevent="createWorkspace"
          >
            <label class="label"
              >New workspace name<input
                v-model="newWorkspaceName"
                class="input"
                maxlength="100"
                required /></label
            ><button :disabled="busy" class="btn-primary">
              Create workspace
            </button>
          </form>
        </details>

        <form
          v-if="can('organization.manage')"
          class="card flex flex-wrap items-end gap-3 p-4"
          @submit.prevent="rename"
        >
          <label class="label"
            >Organization name<input
              v-model="name"
              maxlength="100"
              required
              class="input" /></label
          ><button :disabled="busy" class="btn-primary">Save name</button>
        </form>
        <p v-if="!overview.teamAllowed" class="card p-4 text-sm">
          Team invitations and role changes require the existing Scale
          entitlement. No per-seat pricing is added.
          <NuxtLink class="text-[#b79bff]" to="/dashboard/settings?tab=billing"
            >View billing</NuxtLink
          >
        </p>
        <section class="card p-4" aria-label="Workspace members">
          <h2 class="font-semibold">Members · {{ overview.membersTotal }}</h2>
          <div class="my-3 flex items-center gap-3 text-xs">
            <button
              class="btn-ghost"
              :disabled="memberPage === 0 || loading"
              @click="changeMemberPage(-1)"
            >
              Previous members</button
            ><span>Page {{ memberPage + 1 }}</span
            ><button
              class="btn-ghost"
              :disabled="
                (memberPage + 1) * 50 >= overview.membersTotal || loading
              "
              @click="changeMemberPage(1)"
            >
              Next members
            </button>
          </div>
          <div
            class="mt-3 overflow-x-auto"
            tabindex="0"
            aria-label="Scrollable team table"
          >
            <table class="w-full min-w-[630px] text-left text-sm">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="member in overview.members"
                  :key="member.id"
                  class="border-t border-white/10"
                >
                  <td class="py-3">
                    {{ member.email || member.user_id
                    }}<span
                      v-if="member.user_id === userId"
                      class="ml-2 text-xs text-[#9AA3B2]"
                      >You</span
                    >
                  </td>
                  <td>
                    <select
                      v-if="
                        overview.teamAllowed &&
                        manageable(member) &&
                        member.role !== 'owner'
                      "
                      :value="member.role"
                      class="input"
                      :aria-label="
                        'Role for ' + (member.email || member.user_id)
                      "
                      :disabled="busy"
                      @change="changeRole(member, $event)"
                    >
                      <option v-for="r in allowedRoles" :key="r" :value="r">
                        {{ r }}
                      </option></select
                    ><span v-else class="capitalize">{{ member.role }}</span>
                  </td>
                  <td>{{ date(member.created_at) }}</td>
                  <td>
                    <div class="flex gap-2">
                      <button
                        v-if="member.user_id === userId"
                        :disabled="busy"
                        class="btn-ghost text-xs"
                        @click="leaveWorkspace"
                      >
                        Leave
                      </button>
                      <button
                        v-if="overview.teamAllowed && manageable(member)"
                        :disabled="busy"
                        class="btn-ghost text-xs text-red-300"
                        @click="removeMember(member)"
                      >
                        Remove</button
                      ><button
                        v-if="
                          overview.teamAllowed &&
                          can('organization.transfer') &&
                          member.user_id !== userId &&
                          member.role !== 'owner'
                        "
                        :disabled="busy"
                        class="btn-ghost text-xs"
                        @click="transfer(member)"
                      >
                        Transfer ownership
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <form
          v-if="overview.teamAllowed && can('members.invite')"
          class="card space-y-3 p-4"
          @submit.prevent="invite"
        >
          <h2 class="font-semibold">Invite a teammate</h2>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="label"
              >Email address<input
                v-model="inviteEmail"
                type="email"
                required
                maxlength="254"
                autocomplete="email"
                class="input" /></label
            ><label class="label"
              >Invitation role<select v-model="inviteRole" class="input">
                <option v-for="r in allowedRoles" :key="r" :value="r">
                  {{ r }}
                </option>
              </select></label
            >
          </div>
          <p class="text-sm text-[#9AA3B2]">
            {{ ROLE_DESCRIPTIONS[inviteRole] }}
          </p>
          <label class="flex items-center gap-2 text-sm"
            ><input v-model="sendEmail" type="checkbox" />Send invitation email
            through the configured worker</label
          >
          <p class="text-xs text-[#9AA3B2]">
            Invitations expire in seven days. Acceptance requires the intended
            verified email. Otherwise, copy the private invitation link and
            share it yourself.
          </p>
          <button :disabled="busy" class="btn-primary">
            Create invitation
          </button>
        </form>
        <section
          v-if="can('members.invite')"
          class="card p-4"
          aria-label="Pending invitations"
        >
          <h2 class="font-semibold">Invitation history</h2>
          <p v-if="!overview.invitations.length" class="mt-3 text-sm">
            No invitations.
          </p>
          <article
            v-for="i in overview.invitations"
            :key="i.id"
            class="mt-3 border-t border-white/10 pt-3 text-sm"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p>
                {{ i.email }} · {{ i.role }} · {{ inviteState(i)
                }}<span class="block text-xs text-[#9AA3B2]"
                  >Expires {{ date(i.expires_at) }}</span
                >
              </p>
              <div v-if="!i.accepted_at && !i.revoked_at" class="flex gap-2">
                <button
                  :disabled="busy"
                  class="btn-ghost"
                  @click="resend(i.id)"
                >
                  Resend / replace link</button
                ><button
                  :disabled="busy"
                  class="btn-ghost text-red-300"
                  @click="revokeInvite(i.id)"
                >
                  Revoke
                </button>
              </div>
            </div>
          </article>
          <p class="mt-3 text-xs text-[#9AA3B2]">
            Queued email is not proof of inbox delivery. Check Operations for
            pending or failed invitation mail.
          </p>
        </section>
      </template>
      <template v-if="mode === 'security'">
        <section class="card space-y-3 p-4">
          <h2 class="font-semibold">Account sessions</h2>
          <p class="text-sm">
            Supabase authentication remains authoritative. No custom identity
            provider or hidden support access is introduced. MFA
            enrollment/enforcement and a session inventory are not implemented
            here.
          </p>
          <p class="text-sm">
            Signing out all sessions revokes refresh sessions. Already issued
            access tokens can remain valid until expiry; workspace removal and
            key revocation are checked independently on every operation.
          </p>
          <button class="btn-ghost" @click="signOutEverywhere">
            Sign out all sessions
          </button>
        </section>
        <form
          v-if="can('api_keys.manage')"
          class="card space-y-3 p-4"
          @submit.prevent="createKey"
        >
          <h2 class="font-semibold">Create a scoped management credential</h2>
          <p class="text-sm text-[#9AA3B2]">
            These tokens authorize management APIs, not device telemetry. They
            never replace Secure V2 device roots.
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="label"
              >Credential name<input
                v-model="keyName"
                class="input"
                required
                maxlength="80" /></label
            ><label class="label"
              >Expires after days<input
                v-model.number="keyDays"
                type="number"
                min="1"
                max="366"
                required
                class="input"
            /></label>
          </div>
          <fieldset>
            <legend class="label">Supported scopes</legend>
            <label
              v-for="s in supportedScopes"
              :key="s"
              class="mr-4 inline-flex items-center gap-2 text-sm"
              ><input v-model="keyScopes" type="checkbox" :value="s" />{{
                s
              }}</label
            >
          </fieldset>
          <button :disabled="busy || !keyScopes.length" class="btn-primary">
            Create credential
          </button>
        </form>
        <section
          v-if="can('api_keys.manage')"
          class="card p-4"
          aria-label="Management credentials"
        >
          <h2 class="font-semibold">Management credentials</h2>
          <p v-if="!overview.keys.length" class="mt-3 text-sm">
            No credentials.
          </p>
          <article
            v-for="k in overview.keys"
            :key="k.id"
            class="mt-3 border-t border-white/10 pt-3"
          >
            <div class="flex flex-wrap justify-between gap-3">
              <div>
                <strong>{{ k.name }}</strong>
                <p class="text-xs text-[#9AA3B2]">
                  {{ k.scopes.join(', ') }} ·
                  {{
                    k.revoked_at ? 'Revoked' : 'Expires ' + date(k.expires_at)
                  }}
                  · Last used {{ date(k.last_used_at) }}
                </p>
                <code class="text-xs">{{ k.id }}</code>
              </div>
              <div
                v-if="!k.revoked_at && Date.parse(k.expires_at) > Date.now()"
                class="flex gap-2"
              >
                <button
                  :disabled="busy"
                  class="btn-ghost"
                  @click="rotateKey(k.id)"
                >
                  Rotate</button
                ><button
                  :disabled="busy"
                  class="btn-ghost text-red-300"
                  @click="revokeKey(k.id)"
                >
                  Revoke
                </button>
              </div>
            </div>
          </article>
          <p class="mt-3 text-xs text-[#9AA3B2]">
            120 requests/minute per key. Existing fleet job and entitlement
            limits also apply. Removing its creating member invalidates the
            credential; role changes reduce its effective scopes.
          </p>
        </section>
        <details class="card p-4">
          <summary class="cursor-pointer font-semibold">
            Role permissions
          </summary>
          <article v-for="(caps, r) in ROLE_PERMISSIONS" :key="r" class="mt-4">
            <h3 class="capitalize">{{ r }}</h3>
            <p class="text-sm text-[#9AA3B2]">{{ ROLE_DESCRIPTIONS[r] }}</p>
            <p class="mt-2 break-words font-mono text-xs">
              {{ caps.join(' · ') }}
            </p>
          </article>
        </details>
      </template>
      <template v-if="mode === 'operations' && operations">
        <p class="text-sm text-[#9AA3B2]">
          {{ operations.boundary }}. Updated {{ date(operations.observedAt) }}.
          Missing samples are unknown, not successful uptime.
        </p>
        <section
          class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Service readiness"
        >
          <article
            v-for="s in operations.services"
            :key="s.component"
            class="card p-4"
          >
            <h2 class="capitalize">{{ s.component }}</h2>
            <strong
              class="mt-2 block text-xl capitalize"
              :class="
                s.state === 'ready'
                  ? 'text-emerald-300'
                  : s.state === 'unknown'
                    ? 'text-amber-300'
                    : ''
              "
              >{{ s.state.replaceAll('_', ' ') }}</strong
            >
            <p class="mt-2 text-xs text-[#9AA3B2]">
              Last observation {{ date(s.lastObserved) }}
            </p>
            <details class="mt-3 text-xs">
              <summary class="cursor-pointer">Readiness evidence</summary>
              <p class="mt-2">
                {{ s.observedMinutes }} observed minute buckets / last 24 hours.
                {{ s.observedReadyPercent ?? 'Unavailable' }}% ready among
                observed buckets only. Planned internal objective
                {{ s.plannedObjectivePercent }}%; no contractual SLA or
                network-availability claim.
              </p>
            </details>
          </article>
        </section>
        <section class="card p-4">
          <h2 class="font-semibold">This workspace’s delivery work</h2>
          <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="(v, k) in operations.delivery" :key="k">
              <dt class="text-xs text-[#9AA3B2]">{{ k }}</dt>
              <dd>{{ k === 'oldestPending' ? date(v) : v }}</dd>
            </div>
          </dl>
          <NuxtLink
            class="mt-3 inline-block text-sm text-[#b79bff]"
            to="/dashboard/deliveries"
            >Inspect delivery history</NuxtLink
          >
          <p class="mt-3 text-sm">
            Last metrics aggregation
            {{ date(operations.metrics?.lastAggregated) }}. Invitation email:
            {{ operations.invitationMail?.pending }} pending /
            {{ operations.invitationMail?.dead }} failed.
          </p>
        </section>
        <section class="card p-4">
          <h2 class="font-semibold">Deployment and recovery</h2>
          <p class="mt-2 text-sm">
            Shared hosting is the existing deployment. Isolated Node/PostgreSQL
            recovery is locally tested; dedicated managed and private-cloud
            production services are not qualified. A restored database remains
            quarantined until affected credentials are reprovisioned or revoked.
            See the enterprise guide and operator runbooks.
          </p>
        </section>
      </template>
      <section class="card space-y-3 p-4">
        <h2 class="font-semibold">Support without sharing secrets</h2>
        <label class="label"
          >Optional customer-provided event/device/incident reference<input
            v-model="supportReference"
            class="input"
            placeholder="UUID only"
            maxlength="36"
        /></label>
        <p class="text-sm text-[#9AA3B2]">
          The diagnostic bundle contains workspace ID, your role, time and an
          optional reference. It excludes telemetry, device roots, tokens and
          integration credentials. Review it before sharing.
        </p>
        <button class="btn-ghost" @click="supportBundle">
          Download sanitized context</button
        ><a
          class="ml-3 text-sm text-[#b79bff]"
          href="mailto:support@usestruct.com"
          >support@usestruct.com</a
        >
        <p class="text-xs text-[#9AA3B2]">
          For active data loss or suspected credential compromise, describe the
          impact and UTC timeframe. No guaranteed response time or hidden
          support impersonation is offered.
        </p>
      </section>
    </template>
  </div>
</template>
<script setup lang="ts">
import {
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  type EnterpriseRole,
} from '#shared/permissions'
const props = withDefaults(
  defineProps<{ mode?: 'team' | 'security' | 'operations' }>(),
  { mode: 'team' },
)
const {
    currentOrgId,
    ensureOrganization,
    fetchMemberships,
    can,
    clearOrganizationState,
    createOrganization,
    leaveOrganization,
  } = useOrganization(),
  supabase = useSupabaseClient(),
  user = useSupabaseUser()
const userId = computed(() => user.value?.id || user.value?.sub),
  overview = ref<any>(null),
  operations = ref<any>(null),
  error = ref(''),
  loading = ref(false),
  busy = ref(false),
  secret = ref(''),
  secretTitle = ref(''),
  copied = ref(false),
  name = ref(''),
  inviteEmail = ref(''),
  inviteRole = ref<EnterpriseRole>('viewer'),
  sendEmail = ref(false),
  keyName = ref(''),
  keyDays = ref(30),
  keyScopes = ref<string[]>(['devices.read']),
  supportReference = ref('')
const newWorkspaceName = ref('')
const supportedScopes = [
    'devices.read',
    'devices.create',
    'analytics.read',
    'integrations.read',
  ],
  allowedRoles = computed<EnterpriseRole[]>(() =>
    can('members.manage_admins')
      ? ['admin', 'developer', 'operator', 'viewer']
      : ['developer', 'operator', 'viewer'],
  )
const memberPage = ref(0)
function changeMemberPage(delta: number) {
  memberPage.value += delta
  void refresh()
}
let generation = 0,
  initialized = false,
  timer: ReturnType<typeof setInterval> | undefined
function clearSecret() {
  secret.value = ''
  copied.value = false
}
function date(value: any) {
  return value ? new Date(value).toLocaleString() : 'Unavailable'
}
function manageable(m: any) {
  return (
    can('members.manage_roles') &&
    (!['admin', 'owner'].includes(m.role) || can('members.manage_admins'))
  )
}
function inviteState(i: any) {
  return i.accepted_at
    ? 'Accepted'
    : i.revoked_at
      ? 'Revoked'
      : Date.parse(i.expires_at) <= Date.now()
        ? 'Expired'
        : 'Pending acceptance'
}
async function refresh() {
  const org = currentOrgId.value,
    g = ++generation
  if (!org) return
  loading.value = true
  error.value = ''
  try {
    const r = await $fetch('/api/enterprise', {
      query: { orgId: org, page: memberPage.value },
    })
    if (g !== generation || org !== currentOrgId.value) return
    const previousName = overview.value?.organization?.name
    overview.value = r
    if (!previousName || name.value === previousName)
      name.value = (r as any).organization.name
    if (props.mode === 'operations') {
      const o = await $fetch('/api/enterprise/operations', {
        query: { orgId: org, page: memberPage.value },
      })
      if (g === generation && org === currentOrgId.value) operations.value = o
    }
  } catch (e: any) {
    if (g === generation) {
      error.value = e?.data?.message || 'Unable to load workspace operations.'
      overview.value = null
      operations.value = null
      clearSecret()
    }
  } finally {
    if (g === generation) loading.value = false
  }
}
async function act(action: string, data: any) {
  if (busy.value) return
  const org = currentOrgId.value,
    g = generation
  busy.value = true
  error.value = ''
  clearSecret()
  try {
    const r: any = await $fetch('/api/enterprise/action', {
      method: 'POST',
      body: { orgId: org, action, data },
    })
    if (org !== currentOrgId.value || g !== generation) return
    if (r.credential || r.invitationLink) {
      secret.value = r.credential || r.invitationLink
      secretTitle.value = r.credential
        ? 'One-time management credential'
        : 'Private invitation link'
    }
    await fetchMemberships({ force: true })
    if (org === currentOrgId.value) await refresh()
  } catch (e: any) {
    if (org === currentOrgId.value)
      error.value = e?.data?.message || 'Enterprise operation failed.'
  } finally {
    busy.value = false
  }
}

async function createWorkspace() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await createOrganization(newWorkspaceName.value)
    newWorkspaceName.value = ''
  } catch (e: any) {
    error.value = e.message || 'Unable to create workspace.'
  } finally {
    busy.value = false
  }
}
async function leaveWorkspace() {
  if (
    !confirm(
      'Leave this workspace? Its resources remain; your management keys are revoked. The last owner must transfer ownership first.',
    )
  )
    return
  busy.value = true
  try {
    clearSecret()
    await leaveOrganization()
  } catch (e: any) {
    error.value = e.message || 'Unable to leave workspace.'
  } finally {
    busy.value = false
  }
}

function rename() {
  return act('rename', { name: name.value })
}
function invite() {
  return act('invite', {
    email: inviteEmail.value,
    role: inviteRole.value,
    sendEmail: sendEmail.value,
  })
}
function resend(id: string) {
  if (
    confirm(
      'Replace this invitation link? The previous link will stop working.',
    )
  )
    return act('resend', { id, sendEmail: sendEmail.value })
}
function revokeInvite(id: string) {
  if (confirm('Revoke this invitation?')) return act('revoke_invite', { id })
}
function removeMember(m: any) {
  if (
    confirm(
      'Remove this member and invalidate their workspace management credentials? Devices and telemetry remain.',
    )
  )
    return act('remove', { member: m.id })
}
function changeRole(m: any, e: Event) {
  const next = (e.target as HTMLSelectElement).value
  if (
    confirm(
      `Change this member’s role to ${next}? Their permissions change immediately.`,
    )
  )
    void act('role', { member: m.id, role: next })
  else (e.target as HTMLSelectElement).value = m.role
}
function transfer(m: any) {
  if (
    confirm(
      'Transfer ownership to this existing member and become an administrator?',
    )
  )
    return act('transfer', { member: m.id })
}
function createKey() {
  return act('key_create', {
    name: keyName.value,
    days: keyDays.value,
    scopes: keyScopes.value,
  })
}
function rotateKey(id: string) {
  if (
    confirm(
      'Rotate this management credential now? Its old token stops working immediately. Update your automation with the new credential.',
    )
  )
    return act('key_rotate', { id })
}
function revokeKey(id: string) {
  if (confirm('Revoke this management credential?'))
    return act('key_revoke', { id })
}
async function copySecret() {
  try {
    await navigator.clipboard.writeText(secret.value)
    copied.value = true
  } catch {
    error.value = 'Clipboard unavailable. Select and copy the value manually.'
  }
}
async function signOutEverywhere() {
  if (
    !confirm(
      'Revoke refresh sessions on all devices and sign out here? Access tokens may remain valid until expiry.',
    )
  )
    return
  const r = await supabase.auth.signOut({ scope: 'global' })
  if (r.error) {
    error.value = 'Unable to revoke sessions.'
    return
  }
  clearOrganizationState()
  await navigateTo('/login')
}
function supportBundle() {
  if (
    supportReference.value &&
    !/^[a-f0-9-]{36}$/i.test(supportReference.value)
  ) {
    error.value = 'Use a UUID reference only; never paste credentials.'
    return
  }
  download('struct-support-context.json', {
    format: 'struct-support-context-v1',
    workspaceId: currentOrgId.value,
    role: overview.value?.role,
    capturedAt: new Date().toISOString(),
    customerProvidedReference: supportReference.value || null,
    source: 'Customer-generated context; no support access granted',
  })
}
function download(filename: string, data: any) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    ),
    a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
watch(currentOrgId, () => {
  generation++
  memberPage.value = 0
  overview.value = null
  operations.value = null
  clearSecret()
  if (initialized) void refresh()
})
onMounted(async () => {
  await ensureOrganization()
  initialized = true
  await refresh()
  timer = setInterval(() => {
    if (!document.hidden && !busy.value) void refresh()
  }, 30000)
})
onBeforeUnmount(() => {
  generation++
  clearInterval(timer)
  clearSecret()
})
</script>
