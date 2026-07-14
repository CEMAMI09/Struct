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
      exclude: ['/login', '/signup'],
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
      title: 'Struct — Binary Telemetry',
      meta: [
        {
          name: 'description',
          content: 'Send packed C++ structs over TCP. We turn them into live JSON dashboards.',
        },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
        },
      ],
    },
  },
})
