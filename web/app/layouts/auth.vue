<template>
  <div class="flex min-h-screen items-center justify-center px-4 py-12">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <NuxtLink to="/" class="inline-flex items-center gap-2">
          <span
            class="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00FFA3]/15 font-mono text-lg font-bold text-[#00FFA3]"
          >
            S
          </span>
          <span class="text-2xl font-bold tracking-tight text-[#E8EAEF]">Struct</span>
        </NuxtLink>
        <p class="mt-3 text-sm text-[#8B93A7]">Ultra-lightweight IoT gateway for battery fleets.</p>
      </div>
      <slot />
    </div>
  </div>
</template>
