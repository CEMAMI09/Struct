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
    '/api/stripe/webhook': {
      bodyParser: false,
    },
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
      ],
    },
  },
})
