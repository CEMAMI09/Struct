<template>
  <div class="card p-6">
    <h1 class="mb-1 text-xl font-semibold text-[#E8EAEF]">Sign in</h1>
    <p class="mb-6 text-sm text-[#8B93A7]">Access your Struct dashboard</p>

    <form class="space-y-4" method="post" @submit.prevent="onSubmit">
      <div>
        <label class="label" for="email">Email</label>
        <input
          id="email"
          ref="emailEl"
          v-model="email"
          name="email"
          type="email"
          class="input"
          required
          autocomplete="username"
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
          class="input"
          required
          minlength="6"
          autocomplete="current-password"
          @keydown.enter.prevent="onSubmit"
        />
      </div>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="loading">
        {{ loading ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>

    <div class="my-6 flex items-center gap-3">
      <div class="h-px flex-1 bg-[#2A2F3A]" />
      <span class="text-xs text-[#8B93A7]">or</span>
      <div class="h-px flex-1 bg-[#2A2F3A]" />
    </div>

    <div class="space-y-2">
      <button
        type="button"
        class="btn-ghost flex w-full items-center justify-center gap-2.5"
        @click="loginWithGitHub"
      >
        <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
          <path
            d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z"
          />
        </svg>
        Continue with GitHub
      </button>
      <button
        type="button"
        class="btn-ghost flex w-full items-center justify-center gap-2.5"
        @click="loginWithGoogle"
      >
        <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62Z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"
          />
        </svg>
        Continue with Google
      </button>
    </div>

    <p class="mt-6 text-center text-sm text-[#8B93A7]">
      No account?
      <NuxtLink to="/signup" class="text-[#38B6FF] hover:underline">Create one</NuxtLink>
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

async function waitForUser(timeoutMs = 3000) {
  const start = Date.now()
  while (!user.value && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 40))
  }
  return !!user.value
}

function readCredentials() {
  // DOM values first — autofill often doesn't sync into v-model until blur/click
  const emailVal = (emailEl.value?.value || email.value).trim()
  const passwordVal = passwordEl.value?.value || password.value
  email.value = emailVal
  password.value = passwordVal
  return { emailVal, passwordVal }
}

onMounted(() => {
  loading.value = false
  // Strip credentials that landed in the URL from a non-hydrated native form submit.
  if (import.meta.client && (route.query.email || route.query.password)) {
    const emailFromQuery =
      typeof route.query.email === 'string' ? route.query.email : ''
    if (emailFromQuery && !email.value) email.value = emailFromQuery
    navigateTo({ path: '/login', query: {} }, { replace: true })
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
  try {
    const { data, error: err } = await supabase.auth.signInWithPassword({
      email: emailVal,
      password: passwordVal,
    })
    if (err) {
      error.value = err.message
      return
    }
    if (!data.session) {
      error.value = 'Sign in succeeded but no session was returned. Try again.'
      return
    }
    await supabase.auth.getSession()
    await waitForUser()
    await navigateTo('/dashboard', { replace: true })
  } catch (e: any) {
    error.value = e?.message || 'Sign in failed. Check your connection and try again.'
  } finally {
    loading.value = false
  }
}

async function loginWithGitHub() {
  await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${window.location.origin}/confirm`,
    },
  })
}

async function loginWithGoogle() {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/confirm`,
    },
  })
}
</script>
