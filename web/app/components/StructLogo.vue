<template>
  <img
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
  }>(),
  { size: 'md' },
)

/** Cache-bust when replacing logo assets */
const MARK_SRC = '/struct-logo-mini.svg?v=1'
const FULL_SRC = '/struct-logo.svg?v=8'

const isMark = computed(() => props.size === 'sm')

const src = computed(() => (isMark.value ? MARK_SRC : FULL_SRC))

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
</style>
