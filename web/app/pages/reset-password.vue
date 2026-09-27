<template>
  <div class="card p-7">
    <h1 class="mb-1 text-xl font-semibold tracking-tight text-[#E8EAEF]">Choose a new password</h1>
    <p v-if="checking" class="mt-4 text-sm text-[#9AA3B2]" role="status">Checking your reset link…</p>
    <p v-else-if="linkError" class="mt-4 text-sm text-red-300" role="alert">{{ linkError }}</p>

    <form v-else-if="ready && !updated" class="mt-6 space-y-4" @submit.prevent="updatePassword">
      <p class="text-sm text-[#9AA3B2]">Updating password for <span class="text-[#E8EAEF]">{{ accountEmail }}</span>.</p>
      <div>
        <label class="label" for="new-password">New password</label>
        <input id="new-password" v-model="password" class="auth-field" type="password" minlength="8" autocomplete="new-password" required />
      </div>
      <div>
        <label class="label" for="confirm-password">Confirm new password</label>
        <input id="confirm-password" v-model="confirmation" class="auth-field" type="password" minlength="8" autocomplete="new-password" required />
      </div>
      <p v-if="updateError" role="alert" class="text-sm text-red-300">{{ updateError }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="saving">
        {{ saving ? 'Updating…' : 'Update password' }}
      </button>
    </form>

    <div v-if="updated" class="mt-5 rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-[#E8EAEF]" role="status">
      Your password is updated. You can continue to your dashboard.
    </div>
    <NuxtLink v-if="updated" to="/dashboard" class="btn-primary mt-4 w-full">Open dashboard</NuxtLink>
    <NuxtLink v-else-if="linkError" to="/forgot-password" class="mt-5 inline-block text-sm text-[#b79bff] hover:underline">
      Request a new link
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const supabase = useSupabaseClient()
const checking = ref(true)
const ready = ref(false)
const linkError = ref('')
const updateError = ref('')
const password = ref('')
const confirmation = ref('')
const saving = ref(false)
const updated = ref(false)
const accountEmail = ref('')

onMounted(async () => {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const callbackError = route.query.error_description || route.query.error || hash.get('error_description') || hash.get('error')
  if (callbackError) {
    linkError.value = String(callbackError)
    checking.value = false
    return
  }
  if (route.query.flow !== 'recovery') {
    linkError.value = 'Open the password reset link from your email, or request a new one.'
    checking.value = false
    return
  }

  try {
    // The Supabase browser client exchanges the callback URL before Nuxt mounts
    // this page. The recovery session is then used by updateUser below.
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    if (!data.session?.user) {
      linkError.value = 'This reset link is invalid or expired. Request a new one.'
      return
    }
    accountEmail.value = data.session.user.email || 'your account'
    ready.value = true
    // A link fragment can contain tokens. Clear the fixed callback marker too.
    window.history.replaceState(window.history.state, '', '/reset-password')
  } catch (cause: any) {
    linkError.value = cause?.message || 'Could not verify this reset link. Request a new one.'
  } finally {
    checking.value = false
  }
})

async function updatePassword() {
  if (saving.value) return
  updateError.value = ''
  if (password.value.length < 8) {
    updateError.value = 'Use at least 8 characters.'
    return
  }
  if (password.value !== confirmation.value) {
    updateError.value = 'Passwords do not match.'
    return
  }

  saving.value = true
  try {
    const { error } = await supabase.auth.updateUser({ password: password.value })
    if (error) throw error
    password.value = ''
    confirmation.value = ''
    updated.value = true
  } catch (cause: any) {
    updateError.value = cause?.message || 'Could not update your password. Request a new link.'
  } finally {
    saving.value = false
  }
}
</script>
