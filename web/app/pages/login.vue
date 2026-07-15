<template>
  <div class="card p-6">
    <h1 class="mb-1 text-xl font-semibold text-[#E8EAEF]">Sign in</h1>
    <p class="mb-6 text-sm text-[#8B93A7]">Access your Struct dashboard</p>

    <form class="space-y-4" @submit.prevent="onSubmit">
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

    <p class="mt-6 text-center text-sm text-[#8B93A7]">
      No account?
      <NuxtLink to="/signup" class="text-[#38B6FF] hover:underline">Create one</NuxtLink>
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

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
    const { error: err } = await supabase.auth.signInWithPassword({
      email: emailVal,
      password: passwordVal,
    })
    if (err) {
      error.value = err.message
      return
    }
    await supabase.auth.getSession()
    await waitForUser()
    await navigateTo('/dashboard', { replace: true })
  } finally {
    loading.value = false
  }
}
</script>
