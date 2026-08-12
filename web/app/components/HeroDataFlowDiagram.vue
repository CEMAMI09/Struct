<template>
  <div
    ref="rootEl"
    class="hdf"
    role="img"
    aria-label="Struct Systems telemetry gateway: edge hardware ingests into the gateway, then routes to cloud destinations"
  >
    <svg
      class="hdf-svg"
      :viewBox="`0 0 ${vb.w} ${vb.h}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        v-for="(d, i) in paths"
        :key="`lane-${i}`"
        :d="d"
        class="hdf-path hdf-path--flow"
        fill="none"
        stroke="#38b6ff"
        stroke-width="1.25"
        stroke-dasharray="3.5 4"
      />
    </svg>

    <div class="hdf-layout">
      <!-- Left: raw ingestion -->
      <div class="hdf-col hdf-col--left">
        <div
          v-for="(src, i) in sources"
          :key="src.label"
          :ref="(el) => setSourceRef(el, i)"
          class="hdf-node"
        >
          <span class="hdf-node-icon" aria-hidden="true" v-html="src.icon" />
          <span class="hdf-node-label">{{ src.label }}</span>
        </div>
      </div>

      <!-- Center: gateway hub -->
      <div class="hdf-col hdf-col--center">
        <div ref="hubEl" class="hdf-hub">
          <div class="hdf-hub-ring" aria-hidden="true" />
          <div
            v-for="slot in hubSlots"
            :key="slot.label"
            class="hdf-hub-slot"
            :class="`hdf-hub-slot--${slot.pos}`"
          >
            <span class="hdf-hub-slot-icon" aria-hidden="true" v-html="slot.icon" />
            <span>{{ slot.label }}</span>
          </div>
          <div class="hdf-hub-core">
            <img
              src="/struct-logo-mini.svg?v=1"
              alt=""
              class="hdf-hub-logo"
              draggable="false"
            />
          </div>
        </div>
      </div>

      <!-- Right: cloud destinations -->
      <div class="hdf-col hdf-col--right">
        <div
          v-for="(dest, i) in destinations"
          :key="dest.label"
          :ref="(el) => setDestRef(el, i)"
          class="hdf-node hdf-node--dest"
        >
          <span class="hdf-node-icon" aria-hidden="true" v-html="dest.icon" />
          <span class="hdf-node-label">{{ dest.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

const sources = [
  {
    label: 'Asset Trackers',
    icon: `<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.3"/><path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="10" cy="10" r="1.1" fill="currentColor"/></svg>`,
  },
  {
    label: 'Smart Meters',
    icon: `<svg viewBox="0 0 20 20" fill="none"><rect x="5" y="3.5" width="10" height="13" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M7.5 7h5M7.5 10h5M7.5 13h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  },
  {
    label: 'Ag-Tech Sensors',
    icon: `<svg viewBox="0 0 20 20" fill="none"><path d="M10 16.5V9.5M10 9.5C10 9.5 6.5 9 6.5 5.5 6.5 5.5 10 6 10 9.5ZM10 9.5C10 9.5 13.5 9 13.5 5.5 13.5 5.5 10 6 10 9.5Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="4.2" r="1.2" fill="currentColor"/></svg>`,
  },
  {
    label: 'Microcontrollers',
    icon: `<svg viewBox="0 0 20 20" fill="none"><rect x="5.5" y="5.5" width="9" height="9" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M8 3.5v2M12 3.5v2M8 14.5v2M12 14.5v2M3.5 8h2M3.5 12h2M14.5 8h2M14.5 12h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  },
  {
    label: 'Cellular Modems',
    icon: `<svg viewBox="0 0 20 20" fill="none"><path d="M4.5 14.5h2v-2.5h-2zm4.5 0h2V9.5h-2zm4.5 0h2V6h-2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M14 4.5c1.8 1.2 3 3.2 3 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  },
] as const

const destinations = [
  {
    label: 'Custom Backends',
    icon: `<svg viewBox="0 0 20 20" fill="none"><path d="M4.5 5.5h11v3.2H4.5zm0 5.8h11V14.5H4.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M7 7.1h1.2M7 12.9h1.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  },
  {
    label: 'Databases',
    icon: `<svg viewBox="0 0 20 20" fill="none"><ellipse cx="10" cy="5.2" rx="5.2" ry="2" stroke="currentColor" stroke-width="1.3"/><path d="M4.8 5.2v9.6c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2V5.2" stroke="currentColor" stroke-width="1.3"/><path d="M4.8 10c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2" stroke="currentColor" stroke-width="1.3"/></svg>`,
  },
  {
    label: 'Enterprise Cloud',
    icon: `<svg viewBox="0 0 20 20" fill="none"><path d="M6.2 13.8h8.1a3.1 3.1 0 0 0 .3-6.2 4.2 4.2 0 0 0-8.1-1.1A3.3 3.3 0 0 0 6.2 13.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  },
  {
    label: 'Dashboards',
    icon: `<svg viewBox="0 0 20 20" fill="none"><rect x="3.5" y="4" width="13" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 12.5V9.2M10 12.5V7M13.5 12.5v-2.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  },
] as const

const hubSlots = [
  {
    pos: 'n',
    label: 'Ingest',
    icon: `<svg viewBox="0 0 16 16" fill="none"><path d="M8 13.2V4.2M4.2 7.8 8 4l3.8 3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  {
    pos: 'e',
    label: 'Parse',
    icon: `<svg viewBox="0 0 16 16" fill="none"><path d="M5.2 3.5 2.8 8l2.4 4.5M10.8 3.5 13.2 8l-2.4 4.5M9.1 3.8 6.9 12.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  {
    pos: 's',
    label: 'Route',
    icon: `<svg viewBox="0 0 16 16" fill="none"><path d="M2.8 8h10.4M9.5 4.5 13.2 8l-3.7 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  {
    pos: 'w',
    label: 'Secure',
    icon: `<svg viewBox="0 0 16 16" fill="none"><rect x="3.8" y="7" width="8.4" height="6.2" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M5.8 7V5.4a2.2 2.2 0 0 1 4.4 0V7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  },
] as const

const rootEl = ref<HTMLElement | null>(null)
const hubEl = ref<HTMLElement | null>(null)
const sourceEls = ref<(HTMLElement | null)[]>(Array(sources.length).fill(null))
const destEls = ref<(HTMLElement | null)[]>(Array(destinations.length).fill(null))

const vb = reactive({ w: 1200, h: 560 })

function staticDesktopPaths(): string[] {
  const leftX = 216
  const rightX = 978
  const hubLx = 498
  const hubRx = 702
  const hubY = 280
  const leftYs = [48, 164, 280, 396, 512]
  const rightYs = [70, 210, 350, 490]
  return [
    ...leftYs.map((y) => smoothFunnel(leftX, y, hubLx, hubY)),
    ...rightYs.map((y) => smoothFunnel(hubRx, hubY, rightX, y)),
  ]
}

const paths = ref<string[]>(staticDesktopPaths())

function asEl(el: Element | ComponentPublicInstance | null): HTMLElement | null {
  if (!el) return null
  if (el instanceof HTMLElement) return el
  return (el as ComponentPublicInstance).$el as HTMLElement | null
}

function setSourceRef(el: Element | ComponentPublicInstance | null, i: number) {
  sourceEls.value[i] = asEl(el)
}

function setDestRef(el: Element | ComponentPublicInstance | null, i: number) {
  destEls.value[i] = asEl(el)
}

/**
 * Ably-style funnel cubic: leave/arrive horizontally, pinch at the hub.
 * dx is capped at span/2 so control points never cross.
 */
function smoothFunnel(x1: number, y1: number, x2: number, y2: number): string {
  const span = Math.abs(x2 - x1)
  const dir = Math.sign(x2 - x1) || 1
  const dx = span * 0.5
  const c1x = x1 + dir * dx
  const c2x = x2 - dir * dx
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${c1x.toFixed(1)} ${y1.toFixed(1)}, ${c2x.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

const DESKTOP_MIN = 1024

function isDesktopLayout() {
  return typeof window !== 'undefined' && window.matchMedia(`(min-width: ${DESKTOP_MIN}px)`).matches
}

function measure() {
  const root = rootEl.value
  const hub = hubEl.value
  if (!root || !hub) return

  // Stacked mobile layout hides the SVG — keep seeded paths for the next desktop paint.
  if (!isDesktopLayout()) return

  const rr = root.getBoundingClientRect()
  const nextW = Math.max(1, Math.round(rr.width))
  const nextH = Math.max(1, Math.round(rr.height))

  const hubR = hub.getBoundingClientRect()
  // Single shared meet point each side (inset under the ring so endpoint
  // dash caps never flash at the circle edge).
  const inset = 8
  const hubLeft = {
    x: hubR.left - rr.left + inset,
    y: hubR.top - rr.top + hubR.height / 2,
  }
  const hubRight = {
    x: hubR.right - rr.left - inset,
    y: hubR.top - rr.top + hubR.height / 2,
  }

  const sourceNodes = sourceEls.value.filter(Boolean) as HTMLElement[]
  const destNodes = destEls.value.filter(Boolean) as HTMLElement[]
  if (sourceNodes.length !== sources.length || destNodes.length !== destinations.length) return

  const next: string[] = []

  for (const el of sourceNodes) {
    const r = el.getBoundingClientRect()
    next.push(
      smoothFunnel(
        r.right - rr.left,
        r.top - rr.top + r.height / 2,
        hubLeft.x,
        hubLeft.y,
      ),
    )
  }

  for (const el of destNodes) {
    const r = el.getBoundingClientRect()
    next.push(
      smoothFunnel(
        hubRight.x,
        hubRight.y,
        r.left - rr.left,
        r.top - rr.top + r.height / 2,
      ),
    )
  }

  const sameVb = vb.w === nextW && vb.h === nextH
  const samePaths =
    paths.value.length === next.length && paths.value.every((d, i) => d === next[i])

  if (!sameVb) {
    vb.w = nextW
    vb.h = nextH
  }
  if (!samePaths) {
    paths.value = next
  }
}

let resizeTimer: ReturnType<typeof setTimeout> | null = null

function onWindowResize() {
  // Debounce — ignore carousel / font jitter; only real viewport changes
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    measure()
  }, 180)
}

onMounted(() => {
  measure()
  requestAnimationFrame(() => measure())
  window.addEventListener('resize', onWindowResize, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  if (resizeTimer) clearTimeout(resizeTimer)
})
</script>

<style scoped>
.hdf {
  --hdf-text: #e8eaef;
  --hdf-muted: #8b93a7;
  --hdf-blue: #38b6ff;
  --hdf-border: #2a2f3a;
  --hdf-surface: #15181e;

  position: relative;
  width: 100%;
  isolation: isolate;
  background: transparent;
  /* Mobile-first: stacked funnel, no fixed aspect */
  aspect-ratio: auto;
  min-height: 0;
}

.hdf-svg {
  display: none;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

.hdf-path {
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hdf-path--flow {
  opacity: 0.88;
  /* Offset must be an integer multiple of (dash+gap)=7.5 so the loop is seamless.
     Absolute user-units (no pathLength) → identical dash size + px speed on every lane. */
  animation: hdf-dash 0.85s linear infinite;
}

@keyframes hdf-dash {
  to {
    stroke-dashoffset: -7.5;
  }
}

.hdf-layout {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr;
  align-items: stretch;
  gap: 0.85rem;
  width: 100%;
  height: auto;
  padding: 0.25rem 0;
}

.hdf-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hdf-col--left,
.hdf-col--right {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  justify-content: flex-start;
  align-self: stretch;
}

.hdf-col--left > :last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

.hdf-col--center {
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  padding-block: 0.35rem;
}

/* Vertical flow markers between stacked sections */
.hdf-col--left::after,
.hdf-col--center::after {
  content: '';
  display: block;
  width: 1px;
  height: 1.1rem;
  margin: 0.15rem auto 0;
  background: repeating-linear-gradient(
    to bottom,
    rgba(56, 182, 255, 0.55) 0 3px,
    transparent 3px 6px
  );
}

.hdf-col--left::after {
  grid-column: 1 / -1;
}

/* Shared node cards */
.hdf-node {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 0.6rem 0.75rem;
  border-radius: 10px;
  background: rgba(26, 29, 36, 0.92);
  border: 1px solid rgba(56, 182, 255, 0.32);
  box-shadow: 0 0 14px rgba(56, 182, 255, 0.08);
  min-width: 0;
}

.hdf-node--dest {
  min-height: 2.85rem;
}

.hdf-node-icon {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 1.1rem;
  height: 1.1rem;
  color: var(--hdf-blue);
  filter: drop-shadow(0 0 6px rgba(56, 182, 255, 0.45));
}

.hdf-node-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.hdf-node-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--hdf-text);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Center hub */
.hdf-hub {
  position: relative;
  width: min(200px, 58vw);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  margin-inline: auto;
}

.hdf-hub-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--hdf-surface);
  border: 1px solid rgba(56, 182, 255, 0.3);
  box-shadow:
    0 0 0 1px rgba(42, 47, 58, 0.45),
    0 0 36px rgba(56, 182, 255, 0.12),
    0 0 72px rgba(56, 182, 255, 0.04);
}

.hdf-hub-core {
  position: relative;
  z-index: 2;
  width: 42%;
  aspect-ratio: 1;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #0f1115;
  border: 1px solid rgba(232, 234, 239, 0.3);
  box-shadow: 0 0 18px rgba(56, 182, 255, 0.1);
}

.hdf-hub-logo {
  width: 52%;
  height: auto;
  display: block;
  object-fit: contain;
}

/* Orbit labels — icon + text only, no pills */
.hdf-hub-slot {
  position: absolute;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.55rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--hdf-muted);
  line-height: 1;
  pointer-events: none;
  background: none;
  border: none;
  padding: 0;
}

.hdf-hub-slot-icon {
  display: grid;
  place-items: center;
  width: 0.85rem;
  height: 0.85rem;
  color: var(--hdf-blue);
}

.hdf-hub-slot-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.hdf-hub-slot--n {
  top: 11%;
  left: 50%;
  transform: translateX(-50%);
}

.hdf-hub-slot--e {
  right: 8%;
  top: 50%;
  transform: translateY(-50%);
}

.hdf-hub-slot--s {
  bottom: 11%;
  left: 50%;
  transform: translateX(-50%);
}

.hdf-hub-slot--w {
  left: 7%;
  top: 50%;
  transform: translateY(-50%);
}

@media (min-width: 480px) {
  .hdf-node-label {
    font-size: 0.8125rem;
  }

  .hdf-hub-slot {
    font-size: 0.625rem;
  }
}

/* Desktop: side-by-side with animated wire lanes */
@media (min-width: 1024px) {
  .hdf {
    aspect-ratio: 1280 / 560;
    min-height: 260px;
  }

  .hdf-svg {
    display: block;
  }

  .hdf-layout {
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.95fr) minmax(0, 1.2fr);
    align-items: stretch;
    gap: clamp(1.4rem, 4.2vw, 3.6rem);
    height: 100%;
    padding: clamp(0.65rem, 1.8vw, 1.15rem) clamp(0.4rem, 1.4vw, 0.9rem);
  }

  .hdf-col--left,
  .hdf-col--right {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0;
  }

  .hdf-col--left {
    align-items: flex-start;
  }

  .hdf-col--right {
    align-items: flex-end;
  }

  .hdf-col--left::after,
  .hdf-col--center::after {
    display: none;
  }

  .hdf-col--center {
    padding-block: 0;
  }

  .hdf-node {
    width: 12.75rem;
    gap: 0.6rem;
    padding: 0.65rem 1rem 0.65rem 0.75rem;
    white-space: nowrap;
  }

  .hdf-node--dest {
    width: 13.25rem;
    padding: 1.15rem 1.1rem 1.15rem 0.9rem;
    min-height: 3.35rem;
  }

  .hdf-node-label {
    font-size: clamp(0.7rem, 1.2vw, 0.875rem);
    overflow: visible;
    text-overflow: clip;
  }

  .hdf-hub {
    width: min(100%, clamp(168px, 22vw, 220px));
  }

  .hdf-hub-slot {
    font-size: clamp(0.55rem, 1vw, 0.7rem);
  }

  .hdf-hub-slot-icon {
    width: 0.95rem;
    height: 0.95rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  /* Keep a gentle dash crawl instead of freezing the diagram. */
  .hdf-path--flow {
    animation-duration: 2.6s;
  }
}
</style>
