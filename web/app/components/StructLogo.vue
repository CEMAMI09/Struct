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

/** Cache-bust when replacing the SVG asset */
const src = '/struct-logo.svg?v=5'

const sizeClass = computed(() => {
  // Horizontal wordmark — size by width so it reads large in the nav
  if (props.size === 'sm') return 'h-auto w-[120px]'
  if (props.size === 'lg') return 'h-auto w-[180px]'
  return 'h-auto w-[140px] sm:w-[155px]'
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
