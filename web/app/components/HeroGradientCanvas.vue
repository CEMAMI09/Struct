<template>
  <div class="hgc" aria-hidden="true">
    <div class="hgc-stage">
      <div class="hgc-mask">
        <canvas ref="canvasEl" class="hgc-canvas" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * EMQX-style flowing liquid gradient (simplex noise + fbm),
 * recolored for Struct blues. Lightweight raw WebGL — no Three.js.
 */
const canvasEl = ref<HTMLCanvasElement | null>(null)

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const FRAG = `
precision highp float;
uniform float uTime;
varying vec2 vUv;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float f = 0.0;
  float w = 0.5;
  for (int i = 0; i < 4; i++) {
    f += w * snoise(p);
    p *= 2.0;
    w *= 0.5;
  }
  return f;
}

void main() {
  vec2 uv = vUv;
  float time = uTime * 0.18;

  vec2 flow1 = vec2(
    snoise(uv * 1.0 + vec2(time * 0.6, time * 0.4)) * 0.5,
    snoise(uv * 1.0 + vec2(time * 0.5, -time * 0.6)) * 0.5
  );
  vec2 flow2 = vec2(
    snoise(uv * 1.8 + vec2(-time * 0.4, time * 0.7)) * 0.3,
    snoise(uv * 1.8 + vec2(time * 0.6, time * 0.3)) * 0.3
  );
  vec2 flow3 = vec2(
    snoise(uv * 2.5 + vec2(time * 0.8, -time * 0.5)) * 0.15,
    snoise(uv * 2.5 + vec2(-time * 0.7, time * 0.8)) * 0.15
  );

  vec2 distortedUv = uv + flow1 + flow2 * 0.6 + flow3 * 0.4;

  vec2 deepBlob1 = vec2(0.6 + sin(time * 0.25) * 0.3, 0.4 + cos(time * 0.2) * 0.3);
  vec2 deepBlob2 = vec2(0.35 + cos(time * 0.22) * 0.25, 0.6 + sin(time * 0.28) * 0.25);
  vec2 mainBlob1 = vec2(0.55 + sin(time * 0.35) * 0.22, 0.38 + cos(time * 0.3) * 0.22);
  vec2 mainBlob2 = vec2(0.4 + cos(time * 0.32) * 0.2, 0.58 + sin(time * 0.38) * 0.18);
  vec2 flowBlob1 = vec2(0.7 + cos(time * 0.4) * 0.18, 0.35 + sin(time * 0.45) * 0.15);
  vec2 flowBlob2 = vec2(0.25 + sin(time * 0.42) * 0.15, 0.7 + cos(time * 0.38) * 0.12);
  vec2 flowBlob3 = vec2(0.5 + cos(time * 0.35) * 0.12, 0.25 + sin(time * 0.4) * 0.1);
  vec2 highlightBlob = vec2(0.45 + sin(time * 0.5) * 0.1, 0.42 + cos(time * 0.48) * 0.1);
  vec2 warmSpot1 = vec2(0.58 + sin(time * 0.55) * 0.1, 0.45 + cos(time * 0.5) * 0.1);
  vec2 warmSpot2 = vec2(0.38 + cos(time * 0.6) * 0.08, 0.52 + sin(time * 0.55) * 0.08);

  float sDeep1 = smoothstep(0.6, 0.0, length(distortedUv - deepBlob1));
  float sDeep2 = smoothstep(0.55, 0.0, length(distortedUv - deepBlob2));
  float sMain1 = smoothstep(0.45, 0.0, length(distortedUv - mainBlob1));
  float sMain2 = smoothstep(0.4, 0.0, length(distortedUv - mainBlob2));
  float sFlow1 = smoothstep(0.35, 0.0, length(distortedUv - flowBlob1));
  float sFlow2 = smoothstep(0.32, 0.0, length(distortedUv - flowBlob2));
  float sFlow3 = smoothstep(0.28, 0.0, length(distortedUv - flowBlob3));
  float sHighlight = smoothstep(0.25, 0.0, length(distortedUv - highlightBlob));
  float sWarm1 = smoothstep(0.22, 0.0, length(distortedUv - warmSpot1));
  float sWarm2 = smoothstep(0.18, 0.0, length(distortedUv - warmSpot2));

  // Struct dark palette — cyan / sky / deep navy (vs EMQX purple)
  vec3 deepColor = vec3(0.06, 0.22, 0.48);
  vec3 mainColor = vec3(0.1, 0.42, 0.72);
  vec3 flowColor = vec3(0.16, 0.58, 0.92);
  vec3 coolHighlight = vec3(0.22, 0.71, 1.0);
  vec3 warmA = vec3(0.2, 0.48, 0.7);
  vec3 warmB = vec3(0.28, 0.62, 0.82);
  vec3 warmC = vec3(0.4, 0.8, 1.0);
  vec3 baseColor = vec3(0.06, 0.07, 0.08);

  float intensityMult = 1.75;
  vec3 finalColor = baseColor;
  finalColor = mix(finalColor, deepColor, sDeep1 * 0.28 * intensityMult);
  finalColor = mix(finalColor, deepColor, sDeep2 * 0.25 * intensityMult);
  finalColor = mix(finalColor, mainColor, sMain1 * 0.24 * intensityMult);
  finalColor = mix(finalColor, mainColor, sMain2 * 0.22 * intensityMult);
  finalColor = mix(finalColor, flowColor, sFlow1 * 0.28 * intensityMult);
  finalColor = mix(finalColor, flowColor, sFlow2 * 0.26 * intensityMult);
  finalColor = mix(finalColor, flowColor, sFlow3 * 0.22 * intensityMult);
  finalColor = mix(finalColor, coolHighlight, sHighlight * 0.28 * intensityMult);

  float warmIntensity1 = sWarm1 * sWarm1 * 0.5;
  float warmIntensity2 = sWarm2 * sWarm2 * 0.42;
  finalColor = mix(finalColor, warmA, warmIntensity1);
  finalColor = mix(finalColor, warmB, warmIntensity2 * 0.85);
  finalColor = mix(finalColor, warmC, warmIntensity1 * warmIntensity2 * 2.0);

  float ambient = fbm(distortedUv * 1.5 + time * 0.25) * 0.14 + 0.12;
  float colorCycle = sin(time * 0.25) * 0.5 + 0.5;
  vec3 ambientColor = mix(flowColor, warmB, colorCycle * 0.2);
  ambientColor = mix(ambientColor, mainColor, sin(time * 0.3 + 0.5) * 0.25 + 0.25);
  finalColor = mix(finalColor, ambientColor, ambient * 0.35);

  float pulse = sin(time * 0.15) * 0.1 + 0.62;
  vec3 bgColor = vec3(0.06, 0.07, 0.08);
  vec3 blendedColor = mix(bgColor, finalColor, pulse);

  gl_FragColor = vec4(blendedColor, 1.0);
}
`

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[HeroGradientCanvas]', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

let raf = 0
let resizeObs: ResizeObserver | null = null
let glCtx: WebGLRenderingContext | null = null

onMounted(() => {
  const canvas = canvasEl.value
  if (!canvas) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    powerPreference: 'low-power',
  })
  if (!gl) return
  glCtx = gl

  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return

  const program = gl.createProgram()
  if (!program) return
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[HeroGradientCanvas]', gl.getProgramInfoLog(program))
    return
  }
  gl.useProgram(program)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  )
  const aPos = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  const uTime = gl.getUniformLocation(program, 'uTime')
  const start = performance.now()

  function resize() {
    if (!canvas || !glCtx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      glCtx.viewport(0, 0, w, h)
    }
  }

  resize()
  resizeObs = new ResizeObserver(resize)
  resizeObs.observe(canvas)

  const tick = () => {
    if (!glCtx) return
    glCtx.uniform1f(uTime, (performance.now() - start) / 1000)
    glCtx.drawArrays(gl.TRIANGLES, 0, 6)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  resizeObs?.disconnect()
  glCtx = null
})
</script>

<style scoped>
.hgc {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.hgc-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 4rem;
}

.hgc-mask {
  position: relative;
  width: min(950px, 90vw);
  height: min(600px, 70vh);
  opacity: 0.3;
  mask: radial-gradient(ellipse 50% 50% at center, black 0%, black 60%, transparent 100%);
  -webkit-mask: radial-gradient(
    ellipse 50% 50% at center,
    black 0%,
    black 60%,
    transparent 100%
  );
}

.hgc-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
