<template>
  <div class="password-field">
    <input
      :id="id"
      ref="inputEl"
      :value="modelValue"
      :name="name"
      :type="visible ? 'text' : 'password'"
      class="auth-field"
      :required="required"
      :minlength="minlength"
      :autocomplete="autocomplete"
      @input="onInput"
      @keydown.enter.prevent="emit('enter')"
    />
    <button
      type="button"
      class="password-toggle"
      :aria-label="visible ? 'Hide password' : 'Show password'"
      :aria-pressed="visible"
      :aria-controls="id"
      @mousedown.prevent
      @click="visible = !visible"
    >
      <svg v-if="visible" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2.2 2.2 13.8 13.8"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
        />
        <path
          d="M6.55 6.7a1.6 1.6 0 0 0 2.25 2.28"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
        />
        <path
          d="M4.15 4.4C2.85 5.25 1.75 8 1.75 8s2.05 3.75 6.25 3.75c1.05 0 2-.28 2.82-.72M6.85 4.2A6.4 6.4 0 0 1 8 4.1c4.2 0 6.25 3.9 6.25 3.9s-.5.9-1.42 1.78"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg v-else viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M1.75 8S3.8 4.25 8 4.25 14.25 8 14.25 8 12.2 11.75 8 11.75 1.75 8 1.75 8Z"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linejoin="round"
        />
        <circle cx="8" cy="8" r="1.6" stroke="currentColor" stroke-width="1.25" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    id: string
    modelValue: string
    name?: string
    autocomplete?: string
    minlength?: number
    required?: boolean
  }>(),
  {
    name: 'password',
    autocomplete: 'current-password',
    minlength: 6,
    required: true,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  enter: []
}>()

const inputEl = ref<HTMLInputElement | null>(null)
const visible = ref(false)

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function currentValue() {
  return inputEl.value?.value ?? ''
}

defineExpose({ currentValue })
</script>

<style scoped>
.password-field {
  position: relative;
}

.password-field :deep(.auth-field) {
  padding-right: 2.75rem;
}

.password-toggle {
  position: absolute;
  top: 50%;
  right: 0.2rem;
  display: inline-flex;
  width: 2.25rem;
  height: 2.25rem;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--struct-muted);
  cursor: pointer;
}

.password-toggle:hover {
  color: var(--struct-text);
  background: var(--struct-hover);
}

.password-toggle svg {
  width: 1.05rem;
  height: 1.05rem;
}
</style>
