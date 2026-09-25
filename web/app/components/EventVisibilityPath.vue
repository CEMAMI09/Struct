<template>
  <div
    ref="rootEl"
    class="evp"
    :class="{ 'is-scrub': scrubbing }"
    role="img"
    aria-label="An event starts on an ESP32, is sent from device code, resolves into a verified record, and appears on a live telemetry graph."
  >
    <div ref="trackEl" class="evp-track" :style="trackStyle">
    <svg ref="svgEl" class="evp-svg" aria-hidden="true">
      <path
        ref="pathEl"
        class="evp-path"
        fill="none"
        stroke="#b79bff"
        stroke-width="1.35"
        stroke-linecap="round"
        stroke-linejoin="round"
        :d="pathD"
      />
      <circle
        v-show="pulseOn"
        class="evp-pulse"
        :cx="pulsePt.x"
        :cy="pulsePt.y"
        r="5"
      />
    </svg>

    <article ref="hwEl" class="evp-card evp-card--hw" :style="cardStyle(0)">
      <span :ref="(el) => setAnchor(el, 0)" class="evp-anchor" />
      <p class="evp-kicker"><span class="evp-led" aria-hidden="true" /> Device event generated</p>
      <div class="evp-board">
        <img
          src="/1666364456Esp32_devkitc_v4.png"
          alt=""
          width="640"
          height="360"
          decoding="async"
        />
      </div>
      <p class="evp-micro">Edge telemetry</p>
    </article>

    <article ref="codeEl" class="evp-card evp-card--code" :style="cardStyle(1)">
      <span :ref="(el) => setAnchor(el, 1)" class="evp-anchor" />
      <div class="evp-window">
        <span class="evp-dots" aria-hidden="true"><i /><i /><i /></span>
        <p class="evp-kicker evp-kicker--plain">telemetry.js</p>
      </div>
      <pre class="evp-code"><span>{{ typedCode }}</span><span v-if="showCaret" class="evp-caret" aria-hidden="true" /></pre>
      <div class="evp-send-row">
        <div
          ref="sendEl"
          class="evp-send"
          :class="{ 'is-hover': clickHover, 'is-down': press > 0.2 }"
          :style="{ opacity: sendOpacity, transform: sendTransform }"
        >
          <span class="evp-ripple" :style="rippleStyle" aria-hidden="true" />
          Send event
        </div>
      </div>
      <div v-show="cursor.show" class="evp-cursor" :style="cursor.style" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="18" height="18">
          <path d="M1.2.8 1.2 14.2 5.2 10.4 8.4 15.2 10.7 14.1 7.5 9.3 13.2 8.8Z" fill="#fff" stroke="#161616" stroke-width="0.8" stroke-linejoin="round" />
        </svg>
      </div>
    </article>

    <article class="evp-card evp-card--log" :style="cardStyle(2)">
      <span :ref="(el) => setAnchor(el, 2)" class="evp-anchor" />
      <p class="evp-kicker">Event inspection</p>
      <ul class="evp-rows">
        <li v-for="row in shownRows" :key="row.label" class="evp-row">
          <span class="evp-label">{{ row.label }}</span>
          <span class="evp-leader" aria-hidden="true" />
          <span class="evp-value" :class="{ 'is-clear': row.clear, 'is-ok': row.ok && row.clear }">{{ row.text }}</span>
        </li>
      </ul>
    </article>

    <article ref="graphEl" class="evp-card evp-card--graph" :style="cardStyle(3)">
      <span :ref="(el) => setAnchor(el, 3)" class="evp-anchor" />
      <div class="evp-graph-head">
        <p class="evp-kicker evp-kicker--plain">Telemetry</p>
        <span class="evp-chip" :style="{ opacity: chipOpacity }"><i class="evp-live" aria-hidden="true" /> Live</span>
      </div>
      <svg class="evp-graph" viewBox="0 0 260 104" aria-hidden="true">
        <path class="evp-grid" d="M4 28H256M4 54H256M4 80H256" />
        <path
          class="evp-line"
          :d="graphD"
          pathLength="1"
          stroke-dasharray="1"
          :stroke-dashoffset="1 - graphDraw"
        />
        <circle v-if="graphDraw > 0.02" class="evp-tip" :cx="graphTip.x" :cy="graphTip.y" r="2.6" />
      </svg>
      <div class="evp-chips" :style="{ opacity: chipOpacity }">
        <span class="evp-chip">Delivered</span>
        <span class="evp-chip evp-chip--metric">reaction_time 225 ms</span>
      </div>
    </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

const CODE = `sendTelemetry({
  temp: 22.8,
  battery: 78,
  reaction_time: 225
})`

const ROWS = [
  { label: 'device', value: 'esp32-3', ok: false },
  { label: 'authentication', value: 'verified ✓', ok: true },
  { label: 'schema', value: 'telemetry.v2', ok: false },
  { label: 'payload size', value: '48 bytes', ok: false },
  { label: 'destination', value: 'webhook-prod', ok: false },
  { label: 'status', value: 'delivered', ok: true },
  { label: 'latency', value: '41 ms', ok: false },
] as const

const GRAPH = [
  [6, 76],
  [34, 68],
  [60, 44],
  [88, 52],
  [116, 70],
  [146, 46],
  [174, 30],
  [204, 38],
  [232, 20],
  [254, 24],
] as const

/** Scroll progress → waypoint index along the zig-zag. */
const KEYS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.07, 1],
  [0.11, 1],
  [0.15, 2],
  [0.18, 3],
  [0.21, 4],
  [0.58, 4],
  [0.61, 5],
  [0.64, 6],
  [0.67, 7],
  [0.84, 7],
  [0.87, 8],
  [0.9, 9],
  [0.93, 10],
  [1, 10],
]

type Pt = { x: number, y: number }

const rootEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
const hwEl = ref<HTMLElement | null>(null)
const graphEl = ref<HTMLElement | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)
const pathEl = ref<SVGPathElement | null>(null)
const codeEl = ref<HTMLElement | null>(null)
const sendEl = ref<HTMLElement | null>(null)
const shift = ref(0)
const anchorEls = ref<(HTMLElement | null)[]>([null, null, null, null])
const points = ref<Pt[]>([])
const scrubbing = ref(false)
const progress = ref(0)

let raf = 0
let resizeObserver: ResizeObserver | null = null

function clamp(n: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n))
}

function range(p: number, a: number, b: number) {
  if (b <= a) return p >= b ? 1 : 0
  return clamp((p - a) / (b - a))
}

function asEl(el: Element | ComponentPublicInstance | null): HTMLElement | null {
  if (!el) return null
  if (el instanceof HTMLElement) return el
  return (el as ComponentPublicInstance).$el as HTMLElement | null
}

function setAnchor(el: Element | ComponentPublicInstance | null, index: number) {
  anchorEls.value[index] = asEl(el)
}

function waypointAt(p: number) {
  if (p <= KEYS[0][0]) return KEYS[0][1]
  for (let i = 1; i < KEYS.length; i++) {
    if (p <= KEYS[i][0]) {
      const [p0, w0] = KEYS[i - 1]
      const [p1, w1] = KEYS[i]
      return w0 + (w1 - w0) * ((p - p0) / (p1 - p0))
    }
  }
  return KEYS[KEYS.length - 1][1]
}

function pointAlong(pts: Pt[], w: number) {
  const segLens: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    segLens.push(d)
    total += d
  }
  if (!pts.length || total <= 0) return { x: 0, y: 0, length: 0, total: 0 }
  const idx = clamp(w, 0, pts.length - 1)
  const i = Math.min(pts.length - 2, Math.floor(idx))
  const atEnd = idx >= pts.length - 1
  const t = atEnd ? 1 : idx - i
  const a = pts[i]
  const b = pts[i + 1]
  let length = 0
  for (let s = 0; s < i; s++) length += segLens[s]
  length += segLens[i] * t
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    length,
    total,
  }
}

function buildPoints() {
  const svg = svgEl.value
  const anchors = anchorEls.value
  if (!svg || anchors.some((el) => !el)) return
  const box = svg.getBoundingClientRect()
  if (box.width < 20 || box.height < 20) return
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`)
  const spineX = box.width / 2
  const locals = anchors.map((el) => {
    const r = el!.getBoundingClientRect()
    return {
      x: r.left + r.width / 2 - box.left,
      y: r.top + r.height / 2 - box.top,
    }
  })
  const [a1, a2, a3, a4] = locals
  const s = (y: number): Pt => ({ x: spineX, y })
  points.value = [
    { x: a1.x - 36, y: a1.y },
    a1,
    s(a1.y),
    s(a2.y),
    a2,
    s(a2.y),
    s(a3.y),
    a3,
    s(a3.y),
    s(a4.y),
    a4,
  ]
}

const travel = computed(() => pointAlong(points.value, scrubbing.value ? waypointAt(progress.value) : 10))

const pathD = computed(() => {
  if (points.value.length < 2) return ''
  return points.value.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
})

const pulsePt = ref({ x: 0, y: 0 })

function syncStroke() {
  const path = pathEl.value
  if (!path) return
  const total = path.getTotalLength()
  if (!total) return
  const along = travel.value
  const fraction = !scrubbing.value || along.total <= 0 ? 1 : along.length / along.total
  const drawn = fraction * total
  path.style.strokeDasharray = `${total}`
  path.style.strokeDashoffset = `${Math.max(0, total - drawn)}`
  const pt = path.getPointAtLength(Math.min(total, Math.max(0, drawn)))
  pulsePt.value = { x: pt.x, y: pt.y }
}

watch([pathD, progress, scrubbing], () => {
  syncStroke()
}, { flush: 'post' })

const pulseOn = computed(() => scrubbing.value && progress.value > 0.02 && progress.value < 0.995)

function revealFor(index: number) {
  const w = waypointAt(progress.value)
  const gates = [0.35, 3.65, 6.65, 9.65]
  return clamp((w - gates[index]) / 0.45)
}

function cardStyle(index: number) {
  if (!scrubbing.value) return undefined
  const shown = index === 0 ? range(progress.value, 0.015, 0.08) : revealFor(index)
  return {
    opacity: String(shown),
    transform: `translateY(${(1 - shown) * 12}px)`,
  }
}

const typeT = computed(() => (scrubbing.value ? range(progress.value, 0.23, 0.36) : 1))
const clickT = computed(() => (scrubbing.value ? range(progress.value, 0.38, 0.57) : 0))
const typedCode = computed(() => CODE.slice(0, Math.round(typeT.value * CODE.length)))
const showCaret = computed(() => scrubbing.value && typeT.value > 0.02 && typeT.value < 1 && clickT.value === 0)
const sendOpacity = computed(() => (scrubbing.value ? range(progress.value, 0.345, 0.385) : 1))

function clickPose(t: number) {
  const arrive = 1 - (1 - clamp(t / 0.46)) ** 3
  const hover = clamp((t - 0.4) / 0.12)
  let press = 0
  if (t >= 0.56 && t < 0.66) press = (t - 0.56) / 0.1
  else if (t >= 0.66 && t < 0.8) press = 1 - (t - 0.66) / 0.14
  const ripple = t < 0.58 ? 0 : clamp((t - 0.58) / 0.32)
  return { arrive, hover, press, ripple }
}

const pose = computed(() => clickPose(clickT.value))
const press = computed(() => pose.value.press)
const clickHover = computed(() => pose.value.hover > 0.65 && press.value < 0.35)
const sendTransform = computed(() => {
  const lift = clickHover.value ? -1 : 0
  return `translateY(${lift}px) scale(${1 - press.value * 0.07})`
})
const rippleStyle = computed(() => {
  const ripple = pose.value.ripple
  return {
    opacity: ripple === 0 ? '0' : String(0.4 * (1 - ripple)),
    transform: `scale(${0.25 + ripple * 1.7})`,
  }
})

const cursor = computed(() => {
  const hidden = { show: false, style: { transform: 'translate(-80px, -80px) scale(1)' } }
  if (!scrubbing.value || clickT.value <= 0.01) return hidden
  const card = codeEl.value
  const btn = sendEl.value
  if (!card || !btn) return hidden
  const { arrive, press: down } = pose.value
  const arc = Math.sin(arrive * Math.PI) * -22
  const startX = card.clientWidth * 0.18
  const startY = card.clientHeight * 0.34
  const endX = btn.offsetLeft + btn.offsetWidth * 0.42 - 1
  const endY = btn.offsetTop + btn.offsetHeight * 0.62 - 1
  const x = startX + (endX - startX) * arrive
  const y = startY + (endY - startY) * arrive + arc + down * 3
  return {
    show: clickT.value < 0.99,
    style: { transform: `translate(${x}px, ${y}px) scale(${1 - down * 0.08})` },
  }
})

const GLYPHS = '░▒▓'

function mask(value: string, t: number) {
  if (t >= 1) return value
  if (t <= 0) return value.replace(/[^ ]/g, '░')
  const count = Math.floor(t * value.length)
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === ' ') out += ' '
    else if (i < count) out += ch
    else out += GLYPHS[(i * 3) % GLYPHS.length]
  }
  return out
}

const inspectT = computed(() => (scrubbing.value ? range(progress.value, 0.67, 0.84) : 1))

const shownRows = computed(() => ROWS.map((row, index) => {
  const start = index / ROWS.length
  const end = (index + 0.72) / ROWS.length
  const t = range(inspectT.value, start, end)
  return {
    label: row.label,
    text: mask(row.value, t),
    clear: t > 0.92,
    ok: row.ok,
  }
}))

const graphD = GRAPH.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
const graphDraw = computed(() => (scrubbing.value ? range(progress.value, 0.93, 1) : 1))
const chipOpacity = computed(() => (scrubbing.value ? range(progress.value, 0.96, 1) : 1))

const graphTip = computed(() => {
  const t = graphDraw.value
  let total = 0
  const lens: number[] = []
  for (let i = 1; i < GRAPH.length; i++) {
    const d = Math.hypot(GRAPH[i][0] - GRAPH[i - 1][0], GRAPH[i][1] - GRAPH[i - 1][1])
    lens.push(d)
    total += d
  }
  let remain = t * total
  for (let i = 0; i < lens.length; i++) {
    if (remain <= lens[i] || i === lens.length - 1) {
      const u = lens[i] === 0 ? 0 : clamp(remain / lens[i])
      return {
        x: GRAPH[i][0] + (GRAPH[i + 1][0] - GRAPH[i][0]) * u,
        y: GRAPH[i][1] + (GRAPH[i + 1][1] - GRAPH[i][1]) * u,
      }
    }
    remain -= lens[i]
  }
  const last = GRAPH[GRAPH.length - 1]
  return { x: last[0], y: last[1] }
})

function placeTrack() {
  const view = rootEl.value
  const hw = hwEl.value
  const graph = graphEl.value
  if (!scrubbing.value || !view || !hw || !graph) {
    shift.value = 0
    return
  }
  const start = view.clientHeight / 2 - (hw.offsetTop + hw.offsetHeight / 2)
  const end = view.clientHeight / 2 - (graph.offsetTop + graph.offsetHeight / 2)
  shift.value = start + (end - start) * progress.value
}

const trackStyle = computed(() => (
  scrubbing.value ? { transform: `translate3d(0, ${shift.value}px, 0)` } : undefined
))

function readProgress() {
  const track = rootEl.value?.closest('.product-scroll') as HTMLElement | null
  if (!track) return
  const travelPx = track.offsetHeight - window.innerHeight
  if (travelPx <= 0) progress.value = 1
  else progress.value = clamp(-track.getBoundingClientRect().top / travelPx)
  placeTrack()
}

function onScroll() {
  if (!scrubbing.value || raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    readProgress()
  })
}

function syncMode() {
  const mobile = window.matchMedia('(max-width: 899px)').matches
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  scrubbing.value = !mobile && !reduced
  if (mobile) {
    points.value = []
    progress.value = 1
    return
  }
  if (!scrubbing.value) progress.value = 1
  else readProgress()
  buildPoints()
  placeTrack()
}

function onResize() {
  syncMode()
  if (scrubbing.value) buildPoints()
}

onMounted(() => {
  syncMode()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)
  if (rootEl.value) {
    resizeObserver = new ResizeObserver(() => {
      if (scrubbing.value) buildPoints()
    })
    resizeObserver.observe(rootEl.value)
  }
  const img = rootEl.value?.querySelector('img')
  img?.addEventListener('load', () => {
    buildPoints()
    placeTrack()
  }, { once: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  if (raf) cancelAnimationFrame(raf)
  resizeObserver?.disconnect()
})
</script>

<style scoped>
.evp {
  position: relative;
  width: 100%;
}

.evp-track {
  position: relative;
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 1.25rem;
}

.evp-svg {
  display: none;
}

.evp-pulse {
  fill: #efeaff;
  filter: drop-shadow(0 0 6px rgba(183, 155, 255, 0.95));
}

.evp-path {
  opacity: 0.62;
}

.evp-card {
  position: relative;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.85rem;
  background: #050505;
  padding: 1.15rem 1.2rem 1.25rem;
}

.evp-anchor {
  position: absolute;
  top: 50%;
  width: 1px;
  height: 1px;
}

.evp-kicker {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}

.evp-kicker--plain {
  letter-spacing: 0.08em;
}

.evp-led {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background: #c4b5fd;
  box-shadow: 0 0 0 3px rgba(183, 155, 255, 0.16);
  animation: evp-led 2.4s ease-in-out infinite;
}

.evp-board {
  display: grid;
  place-items: center;
  margin-top: 0.65rem;
  border-radius: 0.65rem;
  background:
    radial-gradient(ellipse at 50% 45%, rgba(183, 155, 255, 0.08), transparent 68%),
    #070708;
}

.evp-board img {
  display: block;
  width: min(100%, 16.5rem);
  height: auto;
  mix-blend-mode: lighten;
}

.evp-micro {
  margin: 0.55rem 0 0;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.75rem;
}

.evp-window {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin: -1.15rem -1.2rem 0.85rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.55rem 0.85rem;
}

.evp-dots {
  display: flex;
  gap: 0.3rem;
}

.evp-dots i {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
}

.evp-dots i:first-child { background: #ff5f57; }
.evp-dots i:nth-child(2) { background: #febc2e; }
.evp-dots i:nth-child(3) { background: #28c840; }

.evp-code {
  min-height: 6.6rem;
  margin: 0;
  white-space: pre;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.8rem;
  line-height: 1.55;
  color: #d7ccff;
}

.evp-caret {
  display: inline-block;
  width: 1px;
  height: 0.85em;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: #b79bff;
  animation: evp-caret 1s steps(1) infinite;
}

.evp-send-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.65rem;
}

.evp-send {
  position: relative;
  overflow: hidden;
  border-radius: 0.5rem;
  background: #fff;
  padding: 0.5rem 0.85rem;
  color: #111;
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1;
  box-shadow: 0 0 0 0 rgba(183, 155, 255, 0);
}

.evp-send.is-hover {
  background: #f4f0ff;
  box-shadow: 0 0 0 3px rgba(183, 155, 255, 0.28);
}

.evp-send.is-down {
  background: #e4dcff;
}

.evp-ripple {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2.4rem;
  height: 2.4rem;
  margin: -1.2rem 0 0 -1.2rem;
  border-radius: 999px;
  background: rgba(86, 23, 252, 0.35);
  pointer-events: none;
}

.evp-cursor {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  width: 18px;
  height: 18px;
  pointer-events: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

.evp-rows {
  display: grid;
  gap: 0.48rem;
  margin: 0.85rem 0 0;
  padding: 0;
  list-style: none;
}

.evp-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.45rem;
  align-items: baseline;
}

.evp-label,
.evp-value {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.78rem;
  line-height: 1.45;
}

.evp-label { color: rgba(255, 255, 255, 0.46); }
.evp-value { color: rgba(255, 255, 255, 0.28); }
.evp-value.is-clear { color: rgba(255, 255, 255, 0.92); }
.evp-value.is-ok { color: #c4b5fd; }

.evp-leader {
  border-bottom: 1px dotted rgba(255, 255, 255, 0.18);
  transform: translateY(-0.2em);
}

.evp-graph-head,
.evp-chips {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.evp-graph-head { justify-content: space-between; }

.evp-graph {
  display: block;
  width: 100%;
  height: auto;
  margin-top: 0.35rem;
}

.evp-grid {
  fill: none;
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 1;
}

.evp-line {
  fill: none;
  stroke: #d7ccff;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.evp-tip { fill: #b79bff; }

.evp-chips {
  flex-wrap: wrap;
  margin-top: 0.35rem;
}

.evp-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  padding: 0.16rem 0.45rem;
  color: rgba(255, 255, 255, 0.72);
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.evp-chip--metric {
  letter-spacing: 0;
  text-transform: none;
}

.evp-live {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 999px;
  background: #b79bff;
}

@media (min-width: 900px) {
  .evp.is-scrub {
    height: 100%;
    overflow: hidden;
  }

  .evp-track {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: 3.5rem;
    row-gap: 2.25rem;
    align-items: center;
    will-change: transform;
  }

  .evp-svg {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .evp.is-scrub .evp-card--hw {
    opacity: 0;
  }

  .evp-card {
    width: min(100%, 22rem);
  }

  .evp-card--log {
    width: min(100%, 24rem);
  }

  .evp-card--hw,
  .evp-card--log {
    grid-column: 1;
    justify-self: end;
  }

  .evp-card--hw { grid-row: 1; }
  .evp-card--log { grid-row: 3; }

  .evp-card--code,
  .evp-card--graph {
    grid-column: 2;
    justify-self: start;
  }

  .evp-card--code { grid-row: 2; }
  .evp-card--graph { grid-row: 4; }

  .evp-card--hw .evp-anchor,
  .evp-card--log .evp-anchor { right: 0; }

  .evp-card--code .evp-anchor,
  .evp-card--graph .evp-anchor { left: 0; }

  .evp-card--code,
  .evp-card--log,
  .evp-card--graph {
    opacity: 0;
  }
}

@media (max-width: 899px) {
  .evp-card {
    animation: evp-in 0.7s ease both;
  }

  .evp-card--code { animation-delay: 0.08s; }
  .evp-card--log { animation-delay: 0.16s; }
  .evp-card--graph { animation-delay: 0.24s; }
}

@media (min-width: 900px) and (prefers-reduced-motion: reduce) {
  .evp-card--code,
  .evp-card--log,
  .evp-card--graph {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .evp-led,
  .evp-caret,
  .evp-card {
    animation: none;
  }
}

@keyframes evp-led {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

@keyframes evp-caret {
  0%, 45% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

@keyframes evp-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
