// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase'],

  css: ['~/assets/css/main.css'],

  supabase: {
    redirect: false,
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/', '/login', '/signup'],
    },
  },

  runtimeConfig: {
    public: {
      tcpHost: process.env.NUXT_PUBLIC_TCP_HOST || '127.0.0.1',
      tcpPort: Number(process.env.NUXT_PUBLIC_TCP_PORT || 8080),
    },
  },

  app: {
    head: {
      title: 'Struct — Ultra-Lightweight IoT Gateway',
      meta: [
        {
          name: 'description',
          content:
            'Extend edge battery life by 10×. Send raw binary over TCP; we handle secure routing, parsing, and cloud integration.',
        },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap',
        },
      ],
    },
  },
})
