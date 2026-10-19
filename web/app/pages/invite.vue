<template>
  <div class="mx-auto max-w-xl space-y-5 p-6">
    <h1 class="text-2xl font-semibold">Join a Struct workspace</h1>
    <p class="text-sm text-[#9AA3B2]">
      Sign in with the invited email and verify it before accepting. Joining
      does not move your existing devices or grant access to other workspaces.
    </p>
    <p v-if="error" role="alert" class="text-red-300">{{ error }}</p>
    <p v-if="success" role="status">Invitation accepted.</p>
    <template v-if="!user"
      ><NuxtLink to="/login?redirect=/invite" class="btn-primary"
        >Sign in</NuxtLink
      ><NuxtLink to="/signup?redirect=/invite" class="btn-ghost ml-3"
        >Create account</NuxtLink
      ></template
    ><button
      v-else
      :disabled="busy || !token || success"
      class="btn-primary"
      @click="accept"
    >
      {{ busy ? 'Checking invitation…' : 'Accept invitation' }}
    </button>
    <p v-if="!token" class="text-sm">
      No invitation token is available. Reopen the private link or ask an
      administrator to resend it.
    </p>
  </div>
</template>
<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const user = useSupabaseUser(),
  { fetchMemberships, setCurrentOrg } = useOrganization(),
  token = ref(''),
  error = ref(''),
  busy = ref(false),
  success = ref(false)
onMounted(() => {
  const t = new URLSearchParams(location.hash.slice(1)).get('token')
  if (t && /^[a-f0-9-]{36}\.[a-f0-9]{64}$/i.test(t)) {
    token.value = t
    sessionStorage.setItem(
      'struct.invitation',
      JSON.stringify({ token: t, at: Date.now() }),
    )
    history.replaceState(null, '', location.pathname)
  } else {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem('struct.invitation') || 'null',
      )
      if (saved && Date.now() - saved.at < 3600000) token.value = saved.token
      else sessionStorage.removeItem('struct.invitation')
    } catch {
      sessionStorage.removeItem('struct.invitation')
    }
  }
})
async function accept() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await $fetch<{ organizationId: string }>(
      '/api/enterprise/accept',
      {
        method: 'POST',
        body: { token: token.value },
      },
    )
    sessionStorage.removeItem('struct.invitation')
    token.value = ''
    success.value = true
    await fetchMemberships({ force: true })
    setCurrentOrg(r.organizationId)
    await navigateTo('/dashboard')
  } catch (e: any) {
    error.value =
      e?.data?.message ||
      'Invitation unavailable. Check your verified email, expiration and the latest link.'
  } finally {
    busy.value = false
  }
}
</script>
