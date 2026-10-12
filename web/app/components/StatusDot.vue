<template>
 <span class="inline-flex items-center gap-1.5" :title="ACTIVITY_HELP">
  <span class="inline-block h-2 w-2 rounded-full" :class="status==='Active'?'bg-[#8fd4ae]':'bg-[#6f7888]'" aria-hidden="true" />
  <span :class="showLabel?'text-[10px] text-[#9AA3B2]':'sr-only'">{{status}}</span>
 </span>
</template>
<script setup lang="ts">
import {ACTIVITY_HELP,type DeviceActivity} from '#shared/deviceActivity'
withDefaults(defineProps<{status?:DeviceActivity;showLabel?:boolean}>(),{status:'Inactive'})
</script>
