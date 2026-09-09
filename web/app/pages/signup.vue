<template>
  <div class="card p-7">
    <h1 class="mb-1 text-xl font-semibold tracking-tight text-[#E8EAEF]">Create an account</h1>
    <p class="mb-6 text-sm text-[#8B93A7]">Five free devices. No credit card required.</p>

    <form class="space-y-4" method="post" @submit.prevent="onSubmit">
      <div>
        <label class="label" for="email">Email</label>
        <input
          id="email"
          ref="emailEl"
          v-model="email"
          name="email"
          type="email"
          class="auth-field"
          required
          autocomplete="email"
          @keydown.enter.prevent="onSubmit"
        />
      </div>
      <div>
        <label class="label" for="password">Password</label>
        <input
          id="password"
          ref="passwordEl"
          v-model="password"
          name="password"
          type="password"
          class="auth-field"
          required
          minlength="6"
          autocomplete="new-password"
          @keydown.enter.prevent="onSubmit"
        />
      </div>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <p v-if="info" class="text-sm text-[#38B6FF]">{{ info }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="loading">
        {{ loading ? 'Creating…' : 'Sign up' }}
      </button>
    </form>

    <AuthSsoButtons />

    <p class="mt-6 text-center text-sm text-[#8B93A7]">
      By creating an account you agree to the
      <NuxtLink to="/terms" class="text-[#38B6FF] hover:underline">Terms of Use</NuxtLink>
      and
      <NuxtLink to="/privacy" class="text-[#38B6FF] hover:underline">Privacy Policy</NuxtLink>.
    </p>
    <p class="mt-3 text-center text-sm text-[#8B93A7]">
      Already have an account?
      <NuxtLink to="/login" class="text-[#38B6FF] hover:underline">Sign in</NuxtLink>
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const emailEl = ref<HTMLInputElement | null>(null)
const passwordEl = ref<HTMLInputElement | null>(null)
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const info = ref('')

watch(
  user,
  (u) => {
    if (u) navigateTo('/dashboard', { replace: true })
  },
  { immediate: true },
)

async function waitForUser(timeoutMs = 3000) {
  const start = Date.now()
  while (!user.value && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 40))
  }
  return !!user.value
}

function readCredentials() {
  const emailVal = (emailEl.value?.value || email.value).trim()
  const passwordVal = passwordEl.value?.value || password.value
  email.value = emailVal
  password.value = passwordVal
  return { emailVal, passwordVal }
}

onMounted(() => {
  loading.value = false
  if (import.meta.client && (route.query.email || route.query.password)) {
    const emailFromQuery =
      typeof route.query.email === 'string' ? route.query.email : ''
    if (emailFromQuery && !email.value) email.value = emailFromQuery
    navigateTo({ path: '/signup', query: {} }, { replace: true })
  }
})

async function onSubmit() {
  if (loading.value) return

  const { emailVal, passwordVal } = readCredentials()
  if (!emailVal || passwordVal.length < 6) {
    error.value = 'Enter a valid email and password (6+ characters).'
    return
  }

  loading.value = true
  error.value = ''
  info.value = ''
  try {
    const { data, error: err } = await supabase.auth.signUp({
      email: emailVal,
      password: passwordVal,
      options: {
        emailRedirectTo: `${window.location.origin}/confirm`,
      },
    })
    if (err) {
      error.value = err.message
      return
    }
    if (data.session) {
      try {
        await useOrganization().ensureOrganization()
      } catch {
        // org bootstrap is retried on dashboard mount
      }
      await supabase.auth.getSession()
      await waitForUser()
      await navigateTo('/dashboard', { replace: true })
      return
    }
    info.value = 'Check your email to confirm, then sign in.'
  } catch (e: any) {
    error.value = e?.message || 'Sign up failed. Check your connection and try again.'
  } finally {
    loading.value = false
  }
}
</script>
