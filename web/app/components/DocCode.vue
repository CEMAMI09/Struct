<template><div class="relative my-3"><button type="button" class="btn-ghost absolute right-2 top-2 text-xs" @click="copy">{{copied?'Copied':'Copy'}}</button><pre class="overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-4 pt-12 text-xs leading-6"><code>{{code}}</code></pre><p v-if="error" role="status" class="text-xs">Select the code and copy it manually.</p></div></template>
<script setup lang="ts">
const props=defineProps<{code:string}>();const copied=ref(false),error=ref(false)
async function copy(){try{await navigator.clipboard.writeText(props.code);copied.value=true}catch{error.value=true}}
</script>
