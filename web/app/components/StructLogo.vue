<template>
  <span v-if="lockup" class="struct-lockup">
    <img
      :src="MARK_DARK"
      alt=""
      class="struct-logo struct-mark logo-for-dark"
      draggable="false"
    />
    <img
      :src="MARK_LIGHT"
      alt=""
      class="struct-logo struct-mark logo-for-light"
      draggable="false"
    />
    <span class="struct-word">Struct</span>
  </span>
  <span v-else class="contents">
    <img
      :src="darkSrc"
      alt="Struct"
      class="struct-logo logo-for-dark"
      :class="sizeClass"
      draggable="false"
    />
    <img
      :src="lightSrc"
      alt=""
      class="struct-logo logo-for-light"
      :class="sizeClass"
      draggable="false"
    />
  </span>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg'
    lockup?: boolean
    /** Full wordmark (landing header, login, signup). */
    variant?: 'default' | 'dark'
  }>(),
  { size: 'md', lockup: false, variant: 'default' },
)

/** Cache-bust when replacing logo assets */
const MARK_DARK = '/struct-icon.svg?v=1'
const MARK_LIGHT = '/3.svg?v=1'
const WORD_DARK = '/structdarkmode.svg?v=1'
const WORD_LIGHT = '/2.svg?v=1'

const isMark = computed(() => props.variant === 'default' && props.size === 'sm')

const darkSrc = computed(() => (isMark.value ? MARK_DARK : WORD_DARK))
const lightSrc = computed(() => (isMark.value ? MARK_LIGHT : WORD_LIGHT))

const sizeClass = computed(() => {
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
