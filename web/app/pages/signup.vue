<template>
  <div class="card p-6">
    <h1 class="mb-1 text-xl font-semibold text-[#E8EAEF]">Create account</h1>
    <p class="mb-6 text-sm text-[#8B93A7]">Start ingesting packed structs</p>

    <form class="space-y-4" method="post" action="#" @submit.prevent="onSubmit">
      <div>
        <label class="label" for="email">Email</label>
        <input
          id="email"
          v-model="email"
          name="email"
          type="email"
          class="input"
          required
          autocomplete="email"
        />
      </div>
      <div>
        <label class="label" for="password">Password</label>
        <input
          id="password"
          v-model="password"
          name="password"
          type="password"
          class="input"
          required
          minlength="6"
          autocomplete="new-password"
        />
      </div>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <p v-if="info" class="text-sm text-[#38B6FF]">{{ info }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="loading">
        {{ loading ? 'Creating…' : 'Sign up' }}
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-[#8B93A7]">
      Already have an account?
      <NuxtLink to="/login" class="text-[#38B6FF] hover:underline">Sign in</NuxtLink>
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const info = ref('')

async function waitForUser(timeoutMs = 3000) {
  const start = Date.now()
  while (!user.value && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 40))
  }
  return !!user.value
}

async function onSubmit(e: Event) {
  if (loading.value) return

  const form = e.target as HTMLFormElement
  const fd = new FormData(form)
  const emailVal = String(fd.get('email') || email.value).trim()
  const passwordVal = String(fd.get('password') || password.value)
  email.value = emailVal
  password.value = passwordVal

  loading.value = true
  error.value = ''
  info.value = ''
  try {
    const { data, error: err } = await supabase.auth.signUp({
      email: emailVal,
      password: passwordVal,
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
  } finally {
    loading.value = false
  }
}
</script>
