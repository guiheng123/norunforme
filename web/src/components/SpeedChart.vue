<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface Geom {
  empty: boolean
  w: number
  h: number
  innerW: number
  innerH: number
  path: string
  area: string
  yTicks: Array<{ y: number; label: string }>
  xTicks: Array<{ x: number; label: string }>
  cpMarks: number[]
  hover: { x: number; y: number } | null
}

const props = withDefaults(
  defineProps<{
    series: number[]
    height?: number
    checkpoints?: number[]
    unit?: string
  }>(),
  { height: 150, checkpoints: () => [], unit: 'm/s' },
)

const PAD = { l: 34, r: 10, t: 12, b: 20 }

const wrap = ref<HTMLDivElement | null>(null)
const width = ref(640)
const hoverIndex = ref<number | null>(null)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!wrap.value) return
  observer = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width ?? 640
    width.value = Math.max(280, Math.round(w))
  })
  observer.observe(wrap.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

const geom = computed<Geom>(() => {
  const data = props.series.map((v) => (Number.isFinite(v) ? Number(v) : 0))
  const w = width.value
  const h = props.height
  const innerW = Math.max(20, w - PAD.l - PAD.r)
  const innerH = Math.max(20, h - PAD.t - PAD.b)
  const base: Geom = {
    empty: true,
    w,
    h,
    innerW,
    innerH,
    path: '',
    area: '',
    yTicks: [],
    xTicks: [],
    cpMarks: [],
    hover: null,
  }
  if (data.length < 2) return base

  const max = Math.max(...data)
  const min = Math.min(...data)
  const yMax = Math.max(max * 1.12, 1)
  const yMin = Math.max(0, min - (max - min) * 0.15)
  const span = Math.max(0.001, yMax - yMin)

  const xAt = (i: number) => PAD.l + (i / (data.length - 1)) * innerW
  const yAt = (v: number) => PAD.t + innerH * (1 - (v - yMin) / span)

  let path = ''
  for (let i = 0; i < data.length; i++) {
    path += `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(data[i]).toFixed(1)} `
  }
  const bottom = (PAD.t + innerH).toFixed(1)
  const area = `${path}L${xAt(data.length - 1).toFixed(1)} ${bottom} L${PAD.l.toFixed(1)} ${bottom} Z`

  const yTicks = [0, 1, 2, 3].map((k) => {
    const value = yMin + (span * k) / 3
    return { y: yAt(value), label: value.toFixed(1) }
  })

  const xTicks = [
    { x: PAD.l, label: '起点' },
    { x: PAD.l + innerW / 2, label: '中途' },
    { x: PAD.l + innerW, label: '终点' },
  ]

  const cpMarks = props.checkpoints
    .filter((i) => i >= 0 && i < data.length)
    .map((i) => xAt(i))

  const hi = hoverIndex.value
  const hover =
    hi !== null && hi >= 0 && hi < data.length ? { x: xAt(hi), y: yAt(data[hi]) } : null

  return { empty: false, w, h, innerW, innerH, path, area, yTicks, xTicks, cpMarks, hover }
})

const readout = computed(() => {
  const data = props.series
  if (!data.length) return ''
  const hi = hoverIndex.value
  if (hi !== null && hi >= 0 && hi < data.length) {
    return `${hi + 1} / ${data.length} · ${Number(data[hi]).toFixed(2)} ${props.unit}`
  }
  const max = Math.max(...data)
  const avg = data.reduce((a, b) => a + (Number(b) || 0), 0) / data.length
  return `均值 ${avg.toFixed(2)} · 峰值 ${max.toFixed(2)} ${props.unit}`
})

function onMove(event: PointerEvent): void {
  if (geom.value.empty) return
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  const relative = event.clientX - rect.left
  const ratio = (relative - PAD.l) / geom.value.innerW
  const index = Math.round(ratio * (props.series.length - 1))
  hoverIndex.value = Math.min(props.series.length - 1, Math.max(0, index))
}

function onLeave(): void {
  hoverIndex.value = null
}
</script>

<template>
  <div ref="wrap" class="chart">
    <svg
      class="chart__svg"
      :width="geom.w"
      :height="geom.h"
      :viewBox="`0 0 ${geom.w} ${geom.h}`"
      role="img"
      aria-label="速度曲线"
      @pointermove="onMove"
      @pointerleave="onLeave"
    >
      <g>
        <line
          v-for="tick in geom.yTicks"
          :key="`g-${tick.label}-${tick.y}`"
          :x1="PAD.l"
          :x2="geom.w - PAD.r"
          :y1="tick.y"
          :y2="tick.y"
          class="chart__grid"
        />
        <text
          v-for="tick in geom.yTicks"
          :key="`t-${tick.label}-${tick.y}`"
          :x="PAD.l - 6"
          :y="tick.y + 3"
          class="chart__ylabel"
          text-anchor="end"
        >
          {{ tick.label }}
        </text>
      </g>

      <template v-if="!geom.empty">
        <path :d="geom.area" class="chart__area" />
        <path :d="geom.path" class="chart__line" />

        <g v-for="(cx, i) in geom.cpMarks" :key="`cp-${i}`">
          <line
            :x1="cx"
            :x2="cx"
            :y1="PAD.t"
            :y2="geom.h - PAD.b"
            class="chart__cp"
          />
          <circle :cx="cx" :cy="geom.h - PAD.b - 1" r="2.4" class="chart__cp-dot" />
        </g>

        <g v-if="geom.hover">
          <line
            :x1="geom.hover?.x ?? 0"
            :x2="geom.hover?.x ?? 0"
            :y1="PAD.t"
            :y2="geom.h - PAD.b"
            class="chart__hover-line"
          />
          <circle :cx="geom.hover?.x ?? 0" :cy="geom.hover?.y ?? 0" r="3" class="chart__hover-dot" />
        </g>

        <text
          :x="geom.w - PAD.r"
          :y="PAD.t - 2"
          class="chart__readout"
          text-anchor="end"
        >
          {{ readout }}
        </text>

        <text
          v-for="tick in geom.xTicks"
          :key="`x-${tick.label}`"
          :x="tick.x"
          :y="geom.h - 5"
          class="chart__xlabel"
          :text-anchor="tick.label === '起点' ? 'start' : tick.label === '终点' ? 'end' : 'middle'"
        >
          {{ tick.label }}
        </text>
      </template>
    </svg>

    <p v-if="geom.empty" class="chart__empty">暂无速度数据</p>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  width: 100%;
  min-width: 0;
}

.chart__svg {
  display: block;
  width: 100%;
  overflow: visible;
  touch-action: none;
}

.chart__grid {
  stroke: #eef2f7;
  stroke-width: 1;
}

.chart__ylabel,
.chart__xlabel {
  font-size: 10px;
  fill: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.chart__area {
  fill: rgba(37, 99, 235, 0.07);
}

.chart__line {
  fill: none;
  stroke: var(--c-primary);
  stroke-width: 1.6;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.chart__cp {
  stroke: #cbd5e1;
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.chart__cp-dot {
  fill: var(--c-warning);
}

.chart__hover-line {
  stroke: var(--c-border-strong);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.chart__hover-dot {
  fill: #ffffff;
  stroke: var(--c-primary);
  stroke-width: 1.6;
}

.chart__readout {
  font-size: 10px;
  fill: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.chart__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--c-text-3);
}
</style>
