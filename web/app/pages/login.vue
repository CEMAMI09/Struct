<template>
  <div class="card p-6">
    <h1 class="mb-1 text-xl font-semibold text-[#E8EAEF]">Sign in</h1>
    <p class="mb-6 text-sm text-[#8B93A7]">Access your Struct dashboard</p>

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
          autocomplete="current-password"
        />
      </div>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="loading">
        {{ loading ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-[#8B93A7]">
      No account?
      <NuxtLink to="/signup" class="text-[#00FFA3] hover:underline">Create one</NuxtLink>
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

async function onSubmit() {
  loading.value = true
  error.value = ''
  const { error: err } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (err) {
    error.value = err.message
    return
  }
  navigateTo('/dashboard')
}
</script>
