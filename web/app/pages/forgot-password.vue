<template>
  <div class="card p-7">
    <h1 class="mb-1 text-xl font-semibold tracking-tight text-[#E8EAEF]">Reset your password</h1>
    <p class="mb-6 text-sm text-[#9AA3B2]">Enter your account email and we’ll send a reset link.</p>

    <form v-if="!sent" class="space-y-4" @submit.prevent="sendResetLink">
      <div>
        <label class="label" for="reset-email">Email</label>
        <input
          id="reset-email"
          v-model.trim="email"
          class="auth-field"
          type="email"
          autocomplete="email"
          required
        />
      </div>
      <p v-if="error" role="alert" class="text-sm text-red-300">{{ error }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="sending">
        {{ sending ? 'Sending…' : 'Send reset link' }}
      </button>
    </form>
    <div v-else role="status" class="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-[#E8EAEF]">
      If an account exists for {{ email }}, a password reset link is on its way. Check your inbox and spam folder.
    </div>

    <NuxtLink to="/login" class="mt-6 inline-block text-sm text-[#b79bff] hover:underline">Back to sign in</NuxtLink>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const supabase = useSupabaseClient()
const email = ref('')
const sending = ref(false)
const sent = ref(false)
const error = ref('')

async function sendResetLink() {
  if (sending.value) return
  sending.value = true
  error.value = ''
  try {
    // Use this origin and a fixed path so email links cannot redirect off-site.
    const redirectTo = new URL('/reset-password?flow=recovery', window.location.origin).toString()
    const { error: requestError } = await supabase.auth.resetPasswordForEmail(email.value.trim(), { redirectTo })
    if (requestError) throw requestError
    sent.value = true
  } catch (cause: any) {
    error.value = cause?.message || 'Could not send the reset link. Try again.'
  } finally {
    sending.value = false
  }
}
</script>
