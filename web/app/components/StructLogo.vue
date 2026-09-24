<template>
  <span v-if="lockup" class="struct-lockup">
    <img
      :src="MARK_SRC"
      alt=""
      class="struct-logo struct-mark"
      draggable="false"
    />
    <span class="struct-word">Struct</span>
  </span>
  <img
    v-else
    :src="src"
    alt="Struct"
    class="struct-logo"
    :class="sizeClass"
    draggable="false"
  />
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg'
    lockup?: boolean
    /** Full wordmark for dark backgrounds (landing header, login, signup). */
    variant?: 'default' | 'dark'
  }>(),
  { size: 'md', lockup: false, variant: 'default' },
)

/** Cache-bust when replacing logo assets */
const MARK_SRC = '/struct-icon.svg?v=1'
const FULL_SRC = '/structdarkmode.svg?v=1'
const DARK_SRC = '/structdarkmode.svg?v=1'

const isMark = computed(() => props.variant === 'default' && props.size === 'sm')

const src = computed(() => {
  if (props.variant === 'dark') return DARK_SRC
  return isMark.value ? MARK_SRC : FULL_SRC
})

const sizeClass = computed(() => {
  // Dashboard uses the compact mark; landing/auth use the full logo
  if (props.size === 'sm') return 'h-10 w-auto'
  if (props.size === 'lg') return 'h-auto w-[180px]'
  return 'h-12 w-auto'
})
</script>

<style scoped>
.struct-logo {
  display: block;
  margin-inline: auto;
  object-fit: contain;
  object-position: center;
}

.struct-lockup {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--struct-text);
}

.struct-mark {
  height: 1.35rem;
  width: auto;
  margin: 0;
}

.struct-word {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1;
}
</style>
