<template>
  <div class="card p-6">
    <h1 class="mb-1 text-xl font-semibold text-[#E8EAEF]">Create account</h1>
    <p class="mb-6 text-sm text-[#8B93A7]">Start ingesting packed structs</p>

    <form class="space-y-4" @submit.prevent="onSubmit">
      <div>
        <label class="label" for="email">Email</label>
        <input id="email" v-model="email" type="email" class="input" required autocomplete="email" />
      </div>
      <div>
        <label class="label" for="password">Password</label>
        <input
          id="password"
          v-model="password"
          type="password"
          class="input"
          required
          minlength="6"
          autocomplete="new-password"
        />
      </div>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <p v-if="info" class="text-sm text-[#00FFA3]">{{ info }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="loading">
        {{ loading ? 'Creating…' : 'Sign up' }}
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-[#8B93A7]">
      Already have an account?
      <NuxtLink to="/login" class="text-[#00FFA3] hover:underline">Sign in</NuxtLink>
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const supabase = useSupabaseClient()
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const info = ref('')

async function onSubmit() {
  loading.value = true
  error.value = ''
  info.value = ''
  const { data, error: err } = await supabase.auth.signUp({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (err) {
    error.value = err.message
    return
  }
  if (data.session) {
    navigateTo('/dashboard')
    return
  }
  info.value = 'Check your email to confirm, then sign in.'
}
</script>
