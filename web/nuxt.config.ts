// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

const sharedDir = fileURLToPath(new URL('./shared', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // Design prototype only. It is not a public page.
  ignore: ['**/pages/test.vue'],

  modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase'],

  css: ['~/assets/css/main.css'],

  alias: {
    '#shared': sharedDir,
  },

  nitro: {
    alias: {
      '#shared': sharedDir,
    },
  },

  supabase: {
    // Prerender calls the Supabase client on every public page. Without a URL
    // and key at build time that client throws and Nitro records a 500.
    url: process.env.NUXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
    key: process.env.NUXT_PUBLIC_SUPABASE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'public-anon-key',
    redirect: false,
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/', '/login', '/signup', '/confirm', '/benchmarks', '/privacy', '/terms'],
    },
  },

  runtimeConfig: {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    stripePriceFlexible: process.env.STRIPE_PRICE_FLEXIBLE,
    stripePricePro: process.env.STRIPE_PRICE_PRO,
    stripePriceScale: process.env.STRIPE_PRICE_SCALE || process.env.STRIPE_PRICE_STUDIO,
    public: {
      tcpHost: process.env.NUXT_PUBLIC_TCP_HOST || '127.0.0.1',
      tcpPort: Number(process.env.NUXT_PUBLIC_TCP_PORT || 8080),
    },
  },

  routeRules: {
    '/': { prerender: true },
    '/benchmarks': { prerender: true },
    '/privacy': { prerender: true },
    '/terms': { prerender: true },
    '/confirm': { ssr: false },
  },

  app: {
    head: {
      title: 'Struct — Telemetry for constrained devices',
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, viewport-fit=cover',
        },
        {
          name: 'description',
          content:
            'Generate a compact encoder, send authenticated telemetry, and trace delivery to your HTTPS backend.',
        },
        { name: 'theme-color', content: '#5617fc' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
    },
  },
})
