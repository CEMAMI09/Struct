<template>
  <div class="app-shell flex min-h-screen items-center justify-center px-4 py-12">
    <div class="w-full max-w-[24rem]">
      <div class="mb-8 text-center">
        <NuxtLink to="/" class="inline-flex w-full justify-center">
          <StructLogo size="lg" />
        </NuxtLink>
      </div>
      <slot />
    </div>
  </div>
</template>
