<template>
  <div class="card p-7 text-center">
    <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
    <p v-else class="text-sm text-[#8B93A7]">Confirming session…</p>
    <NuxtLink
      v-if="error"
      to="/login"
      class="mt-4 inline-block text-sm text-[#b79bff] hover:underline"
    >
      Back to sign in
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const error = ref('')
let redirected = false

function queryError() {
  const description =
    typeof route.query.error_description === 'string' ? route.query.error_description : ''
  const code = typeof route.query.error === 'string' ? route.query.error : ''
  return description || code
}

async function goDashboard() {
  if (redirected) return
  redirected = true
  await navigateTo('/dashboard', { replace: true })
}

watch(
  user,
  (u) => {
    if (u) return goDashboard()
  },
  { immediate: true },
)

onMounted(async () => {
  const fromOAuth = queryError()
  if (fromOAuth) {
    error.value = fromOAuth
    return
  }

  const start = Date.now()
  while (!user.value && Date.now() - start < 8000) {
    const { data } = await supabase.auth.getSession()
    if (data.session?.user) {
      await goDashboard()
      return
    }
    await new Promise((r) => setTimeout(r, 80))
  }

  if (!user.value) {
    error.value = 'Could not confirm your session. Try signing in again.'
  }
})
</script>
