import type { Config } from 'tailwindcss'

export default {
  content: [
    './app/components/**/*.{vue,js,ts}',
    './app/layouts/**/*.vue',
    './app/pages/**/*.vue',
    './app/app.vue',
    './app/plugins/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      colors: {
        struct: {
          bg: '#000000',
          card: '#101012',
          border: 'rgba(255, 255, 255, 0.08)',
          blue: '#5617fc',
          muted: '#9AA3B2',
        },
      },
      fontFamily: {
        sans: ['Figtree', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
