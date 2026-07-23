<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-6">
      <h2 class="text-lg font-semibold text-[#E8EAEF]">Organization</h2>
      <p class="text-sm text-[#8B93A7]">
        Manage your team workspace, roles, and who can edit devices and schemas.
      </p>
    </div>

    <p v-if="orgError" class="mb-4 text-sm text-red-400">{{ orgError }}</p>
    <p v-if="pageError" class="mb-4 text-sm text-red-400">{{ pageError }}</p>
    <p v-if="pageMsg" class="mb-4 text-sm text-[#38B6FF]">{{ pageMsg }}</p>

    <!-- Org identity -->
    <section class="card mb-4 p-4">
      <p class="label">Workspace</p>
      <div class="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div class="min-w-0 flex-1">
          <input
            v-model="orgNameDraft"
            class="input"
            :disabled="!canWrite || savingName"
            placeholder="Organization name"
          />
        </div>
        <button
          v-if="canWrite"
          type="button"
          class="btn-primary shrink-0"
          :disabled="savingName || orgNameDraft.trim() === currentOrganization?.name"
          @click="onRename"
        >
          {{ savingName ? 'Saving…' : 'Save name' }}
        </button>
      </div>
      <div class="mt-4 flex flex-wrap gap-3 text-xs text-[#8B93A7]">
        <span>
          Your role:
          <span class="font-mono uppercase text-[#38B6FF]">{{ role }}</span>
        </span>
      </div>
    </section>

    <!-- Switch / create org -->
    <section class="card mb-4 p-4">
      <p class="label">Workspaces</p>
      <p
        v-if="memberships.length > 1"
        class="mt-1 text-xs text-[#8B93A7]"
      >
        You belong to {{ memberships.length }} workspaces. Switch here if devices or billing look
        wrong — an empty free Personal workspace may have been created by accident.
      </p>
      <div class="mt-2 space-y-2">
        <div
          v-for="m in memberships"
          :key="m.organization_id"
          class="flex items-stretch gap-2"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition"
            :class="
              m.organization_id === currentOrgId
                ? 'border-[#38B6FF]/50 bg-[#38B6FF]/5 text-[#E8EAEF]'
                : 'border-[#2A2F3A] text-[#8B93A7] hover:border-[#38B6FF]/30 hover:text-[#E8EAEF]'
            "
            @click="onSwitchOrg(m.organization_id)"
          >
            <span class="min-w-0 truncate">
              {{ m.organization.name }}
              <span class="ml-2 font-mono text-[10px] capitalize text-[#8B93A7]">
                {{ m.organization.subscription_tier }}
              </span>
            </span>
            <span class="shrink-0 font-mono text-[10px] uppercase">{{ m.role }}</span>
          </button>
          <button
            v-if="m.role === 'owner'"
            type="button"
            class="btn-ghost shrink-0 px-2.5 text-[10px] text-red-400"
            :disabled="deletingOrgId === m.organization_id"
            @click="onDeleteOrg(m.organization_id, m.organization.name)"
          >
            {{ deletingOrgId === m.organization_id ? '…' : 'Delete' }}
          </button>
        </div>
      </div>

      <form v-if="canWrite || memberships.length" class="mt-4 flex flex-col gap-2 sm:flex-row" @submit.prevent="onCreateOrg">
        <input
          v-model="newOrgName"
          class="input flex-1"
          placeholder="New organization name"
          required
        />
        <button type="submit" class="btn-ghost shrink-0" :disabled="creatingOrg">
          {{ creatingOrg ? 'Creating…' : 'Create org' }}
        </button>
      </form>
    </section>

    <!-- Members -->
    <section class="card p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p class="label mb-0">Members</p>
        <span class="font-mono text-[10px] text-[#8B93A7]">{{ members.length }} total</span>
      </div>

      <div
        v-if="!canUseTeamRbac"
        class="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-300"
      >
        Team invitations and role management require Scale.
        <NuxtLink to="/dashboard/settings" class="underline">View plans</NuxtLink>
      </div>

      <form
        v-if="canWrite && canUseTeamRbac"
        class="mb-4 grid gap-2 sm:grid-cols-[1fr_120px_auto]"
        @submit.prevent="onInvite"
      >
        <input
          v-model="inviteEmail"
          type="email"
          class="input"
          placeholder="teammate@company.com"
          required
        />
        <select v-model="inviteRole" class="input">
          <option value="viewer">viewer</option>
          <option value="admin">admin</option>
          <option v-if="isOwner" value="owner">owner</option>
        </select>
        <button type="submit" class="btn-primary" :disabled="inviting">
          {{ inviting ? 'Adding…' : 'Add member' }}
        </button>
      </form>
      <p v-if="canWrite && canUseTeamRbac" class="mb-4 text-[10px] text-[#8B93A7]">
        Teammates must already have a Struct account. Viewers can read only; admins can edit
        devices/schemas.
      </p>

      <div v-if="loadingMembers" class="py-6 text-center text-sm text-[#8B93A7]">
        Loading members…
      </div>
      <div v-else-if="!members.length" class="py-6 text-center text-sm text-[#8B93A7]">
        Run migration 006 in Supabase if member emails fail to load, then refresh.
      </div>
      <ul v-else class="divide-y divide-[#2A2F3A]">
        <li
          v-for="m in members"
          :key="m.id"
          class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0">
            <p class="truncate text-sm text-[#E8EAEF]">{{ m.email || m.user_id.slice(0, 8) }}</p>
            <p class="font-mono text-[10px] text-[#8B93A7]">{{ m.user_id }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select
              v-if="isOwner && !isSelf(m) && canUseTeamRbac"
              class="input py-1.5 text-xs"
              :value="m.role"
              @change="onRoleChange(m.id, ($event.target as HTMLSelectElement).value)"
            >
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
            <span
              v-else
              class="rounded border border-[#2A2F3A] px-2 py-1 font-mono text-[10px] uppercase text-[#38B6FF]"
            >
              {{ m.role }}
            </span>
            <!-- Your row: always Leave (any role). Never show Remove on yourself. -->
            <button
              v-if="isSelf(m)"
              type="button"
              class="btn-ghost py-1 text-[10px] text-red-400"
              @click="onLeave"
            >
              Leave
            </button>
            <!-- Only owners can remove other people; admins/viewers cannot. -->
            <button
              v-else-if="isOwner"
              type="button"
              class="btn-ghost py-1 text-[10px] text-red-400"
              @click="onRemove(m.id)"
            >
              Remove
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

import type { OrgRole } from '~/types'

const user = useSupabaseUser()
const {
  memberships,
  currentOrgId,
  currentOrganization,
  role,
  canWrite,
  isOwner,
  error: orgError,
  ensureOrganization,
  setCurrentOrg,
  renameOrganization,
  listMembers,
  addMemberByEmail,
  updateMemberRole,
  removeMember,
  leaveOrganization,
  createOrganization,
  deleteOrganization,
  fetchMemberships,
} = useOrganization()
const { hasEntitlement } = useEntitlements()
const canUseTeamRbac = computed(() => hasEntitlement('team_rbac'))

const userId = computed(() => user.value?.id || '')
const userEmail = computed(() => (user.value?.email || '').toLowerCase())

function isSelf(m: { user_id: string; email?: string | null }) {
  if (userId.value && m.user_id === userId.value) return true
  if (userEmail.value && m.email && m.email.toLowerCase() === userEmail.value) return true
  return false
}

const orgNameDraft = ref('')
const savingName = ref(false)
const newOrgName = ref('')
const creatingOrg = ref(false)
const deletingOrgId = ref<string | null>(null)
const members = ref<Awaited<ReturnType<typeof listMembers>>>([])
const loadingMembers = ref(false)
const inviteEmail = ref('')
const inviteRole = ref<OrgRole>('viewer')
const inviting = ref(false)
const pageError = ref('')
const pageMsg = ref('')

async function refreshMembers() {
  loadingMembers.value = true
  pageError.value = ''
  try {
    members.value = await listMembers()
  } catch (e: any) {
    pageError.value = e.message || 'Failed to load members (is migration 006 applied?)'
    members.value = []
  } finally {
    loadingMembers.value = false
  }
}

onMounted(async () => {
  await ensureOrganization()
  orgNameDraft.value = currentOrganization.value?.name || ''
  await refreshMembers()
})

watch(currentOrganization, (org) => {
  if (org) orgNameDraft.value = org.name
})

watch(currentOrgId, async () => {
  await refreshMembers()
})

async function onRename() {
  savingName.value = true
  pageError.value = ''
  pageMsg.value = ''
  try {
    await renameOrganization(orgNameDraft.value)
    pageMsg.value = 'Organization name updated.'
  } catch (e: any) {
    pageError.value = e.message
  } finally {
    savingName.value = false
  }
}

function onSwitchOrg(id: string) {
  if (id === currentOrgId.value) return
  setCurrentOrg(id)
  window.location.reload()
}

async function onCreateOrg() {
  creatingOrg.value = true
  pageError.value = ''
  try {
    await createOrganization(newOrgName.value)
    newOrgName.value = ''
    window.location.reload()
  } catch (e: any) {
    pageError.value = e.message
  } finally {
    creatingOrg.value = false
  }
}

async function onDeleteOrg(orgId: string, name: string) {
  const ok = confirm(
    `Delete workspace “${name}”? This permanently removes its devices, schemas, and destinations.`,
  )
  if (!ok) return

  deletingOrgId.value = orgId
  pageError.value = ''
  pageMsg.value = ''
  try {
    await deleteOrganization(orgId)
    pageMsg.value = 'Workspace deleted.'
    window.location.reload()
  } catch (e: any) {
    pageError.value = e.message
  } finally {
    deletingOrgId.value = null
  }
}

async function onInvite() {
  inviting.value = true
  pageError.value = ''
  pageMsg.value = ''
  try {
    await addMemberByEmail(inviteEmail.value, inviteRole.value)
    inviteEmail.value = ''
    pageMsg.value = 'Member added.'
    await refreshMembers()
    await fetchMemberships()
  } catch (e: any) {
    pageError.value = e.message
  } finally {
    inviting.value = false
  }
}

async function onRoleChange(memberId: string, next: string) {
  pageError.value = ''
  try {
    await updateMemberRole(memberId, next as OrgRole)
    await refreshMembers()
  } catch (e: any) {
    pageError.value = e.message
    await refreshMembers()
  }
}

async function onRemove(memberId: string) {
  if (!confirm('Remove this member from the organization?')) return
  pageError.value = ''
  try {
    await removeMember(memberId)
    await refreshMembers()
  } catch (e: any) {
    pageError.value = e.message
  }
}

async function onLeave() {
  if (!confirm('Leave this workspace? You will lose access until invited again.')) return
  pageError.value = ''
  try {
    await leaveOrganization()
    window.location.reload()
  } catch (e: any) {
    pageError.value = e.message
  }
}
</script>
