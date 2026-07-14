<template>
  <img
    src="/struct-logo.svg"
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

const sizeClass = computed(() => {
  if (props.size === 'sm') return 'h-7'
  if (props.size === 'lg') return 'h-10'
  return 'h-8'
})
</script>

<style scoped>
.struct-logo {
  width: auto;
  display: block;
  margin-inline: auto;
  object-fit: contain;
  object-position: center;
}
</style>
