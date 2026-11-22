<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { TrackCheckpoint, TrackPointDTO } from '../api/types'

const props = withDefaults(
  defineProps<{
    points: TrackPointDTO[]
    checkpoints?: TrackCheckpoint[]
    height?: number
    showSpeed?: boolean
    loading?: boolean
    emptyText?: string
    drawable?: boolean
    path?: Array<[number, number]>
  }>(),
  {
    checkpoints: () => [],
    height: 380,
    showSpeed: true,
    loading: false,
    emptyText: '暂无轨迹数据',
    drawable: false,
    path: () => [],
  },
)

const emit = defineEmits<{
  (e: 'update:path', value: Array<[number, number]>): void
}>()

const el = ref<HTMLDivElement | null>(null)
let map: L.Map | null = null
let layers: L.LayerGroup | null = null
let drawLayer: L.LayerGroup | null = null
let observer: ResizeObserver | null = null
let drawn: Array<[number, number]> = []
let fitted = false
let cpSig = ''

const SPEED_STOPS = [
  { max: 2, color: '#94a3b8', label: '< 2.0' },
  { max: 3, color: '#60a5fa', label: '2.0 – 3.0' },
  { max: 4, color: '#2563eb', label: '3.0 – 4.0' },
  { max: 5, color: '#16a34a', label: '4.0 – 5.0' },
  { max: Number.POSITIVE_INFINITY, color: '#d97706', label: '≥ 5.0' },
]

function colorFor(speed: number): string {
  for (const stop of SPEED_STOPS) {
    if (speed < stop.max) return stop.color
  }
  return SPEED_STOPS[SPEED_STOPS.length - 1].color
}

const startIcon = L.divIcon({
  className: 'tm-pin tm-pin--start',
  html: '<span class="tm-pin__dot"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const endIcon = L.divIcon({
  className: 'tm-pin tm-pin--end',
  html: '<span class="tm-pin__dot"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const WAYPOINT_COLOR = '#0f172a'

type BaseLayerKey = 'street' | 'satellite'

interface BaseLayerDef {
  key: BaseLayerKey
  label: string
  url: string
  subdomains: string[]
  maxZoom: number
  attribution: string
}

const BASE_LAYERS: BaseLayerDef[] = [
  {
    key: 'street',
    label: '街道',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    maxZoom: 18,
    attribution: '© 高德地图',
  },
  {
    key: 'satellite',
    label: '卫星',
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    maxZoom: 18,
    attribution: '© 高德地图',
  },
]

const baseKey = ref<BaseLayerKey>('street')
const tileBroken = ref(false)
let baseLayer: L.TileLayer | null = null

function makeBase(def: BaseLayerDef): L.TileLayer {
  const layer = L.tileLayer(def.url, {
    subdomains: def.subdomains,
    maxZoom: def.maxZoom,
    maxNativeZoom: def.maxZoom,
    attribution: def.attribution,
  })
  let errors = 0
  let ok = 0
  layer.on('tileload', () => {
    ok += 1
    if (ok >= 3) tileBroken.value = false
  })
  layer.on('tileerror', () => {
    errors += 1
    if (ok === 0 && errors >= 4) tileBroken.value = true
  })
  return layer
}

function setBase(key: BaseLayerKey): void {
  if (!map) return
  baseKey.value = key
  tileBroken.value = false
  if (baseLayer) map.removeLayer(baseLayer)
  const def = BASE_LAYERS.find((b) => b.key === key) ?? BASE_LAYERS[0]
  baseLayer = makeBase(def).addTo(map)
  baseLayer.bringToBack()
}

function initMap(): void {
  if (!el.value || map) return
  const first = props.points[0]
  const center: L.LatLngExpression = first ? [first.a, first.o] : [22.53332, 113.93041]
  map = L.map(el.value, {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
    zoomSnap: 0.5,
    minZoom: 3,
    maxZoom: 18,
    maxBoundsViscosity: 0.6,
  }).setView(center, 16)

  setBase('street')

  layers = L.layerGroup().addTo(map)
  drawLayer = L.layerGroup().addTo(map)

  if (props.drawable) {
    map.on('click', (e: L.LeafletMouseEvent) => {
      drawn = [...drawn, [Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7))]]
      renderDraft()
      emit('update:path', drawn)
    })
  }

  observer = new ResizeObserver(() => {
    map?.invalidateSize()
  })
  observer.observe(el.value)
}

function clear(): void {
  layers?.clearLayers()
}

function drawCheckpoints(target: L.LayerGroup): void {
  for (const cp of props.checkpoints) {
    L.circleMarker([cp.lat, cp.lng], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: cp.hit ? '#2563eb' : '#94a3b8',
      fillOpacity: 1,
    })
      .addTo(target)
      .bindTooltip(`${cp.name || cp.id}${cp.hit ? ' · 已命中' : ' · 未命中'}`, { direction: 'top' })
  }
}

function draw(): void {
  if (!map || !layers) return
  const sig = props.checkpoints.map((c) => `${c.lat},${c.lng}`).join(';')
  if (sig !== cpSig) {
    cpSig = sig
    fitted = false
  }
  clear()

  const pts = props.points
  if (pts.length >= 2) {
    if (props.showSpeed) {
      const groups: Array<{ color: string; line: Array<[number, number]> }> = []
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1]
        const next = pts[i]
        const speed = (Number(prev.s) + Number(next.s)) / 2 || 0
        const color = colorFor(speed)
        const last = groups[groups.length - 1]
        if (!last || last.color !== color) {
          groups.push({ color, line: [[prev.a, prev.o], [next.a, next.o]] })
        } else {
          last.line.push([next.a, next.o])
        }
      }
      for (const group of groups) {
        L.polyline(group.line, {
          color: group.color,
          weight: 4,
          opacity: 0.92,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(layers as L.LayerGroup)
      }
    } else {
      L.polyline(
        pts.map((p) => [p.a, p.o] as [number, number]),
        { color: '#2563eb', weight: 4, opacity: 0.92, lineCap: 'round', lineJoin: 'round' },
      ).addTo(layers as L.LayerGroup)
    }

    const first = pts[0]
    const last = pts[pts.length - 1]
    L.marker([first.a, first.o], { icon: startIcon, title: '起点' }).addTo(layers).bindTooltip('起点', {
      direction: 'top',
    })
    L.marker([last.a, last.o], { icon: endIcon, title: '终点' }).addTo(layers).bindTooltip('终点', {
      direction: 'top',
    })

    drawCheckpoints(layers)

    const bounds = L.latLngBounds(pts.map((p) => [p.a, p.o] as [number, number]))
    if (bounds.isValid() && !fitted) {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 })
      fitted = true
    }
  } else if (props.checkpoints.length) {
    drawCheckpoints(layers)
    if (!fitted) {
      const bounds = L.latLngBounds(props.checkpoints.map((c) => [c.lat, c.lng] as [number, number]))
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 })
        fitted = true
      }
    }
  }
}

function renderDraft(): void {
  if (!drawLayer) return
  drawLayer.clearLayers()
  if (drawn.length === 0) return
  if (drawn.length >= 2) {
    L.polyline(drawn, { color: WAYPOINT_COLOR, weight: 3, dashArray: '6 4', opacity: 0.9 }).addTo(drawLayer as L.LayerGroup)
  }
  drawn.forEach((p, i) => {
    L.circleMarker(p, {
      radius: i === 0 ? 7 : 4,
      color: '#ffffff',
      weight: 2,
      fillColor: i === 0 ? '#16a34a' : WAYPOINT_COLOR,
      fillOpacity: 1,
    })
      .addTo(drawLayer as L.LayerGroup)
      .bindTooltip(i === 0 ? '起点' : `第 ${i + 1} 点`, { direction: 'top' })
  })
  if (drawn.length >= 2) {
    let total = 0
    for (let i = 1; i < drawn.length; i++) {
      const [a1, o1] = drawn[i - 1]
      const [a2, o2] = drawn[i]
      const dLat = (a2 - a1) * 111320
      const dLng = (o2 - o1) * 111320 * Math.cos(((a1 + a2) / 2) * (Math.PI / 180))
      total += Math.hypot(dLat, dLng)
    }
    lengthText.value = `${(total / 1000).toFixed(3)} km / ${drawn.length} 点`
  } else {
    lengthText.value = drawn.length ? '再点一个点' : ''
  }
}

const lengthText = ref('')

function syncPath(next: Array<[number, number]>): void {
  drawn = next.map((p) => [Number(p[0]), Number(p[1])] as [number, number])
  renderDraft()
}

function undo(): void {
  if (!drawn.length) return
  drawn = drawn.slice(0, -1)
  renderDraft()
  emit('update:path', drawn)
}

function closeLoop(): void {
  if (drawn.length < 3) return
  const first = drawn[0]
  const last = drawn[drawn.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return
  drawn = [...drawn, [first[0], first[1]]]
  renderDraft()
  emit('update:path', drawn)
}

function clearDraft(): void {
  drawn = []
  fitted = false
  renderDraft()
  emit('update:path', [])
}

function fitAll(): void {
  if (!map) return
  const pts: Array<[number, number]> = [
    ...drawn,
    ...props.points.map((p) => [p.a, p.o] as [number, number]),
    ...props.checkpoints.map((c) => [c.lat, c.lng] as [number, number]),
  ]
  if (!pts.length) return
  const b = L.latLngBounds(pts)
  if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 17 })
}

onMounted(() => {
  initMap()
  draw()
  syncPath(props.path || [])
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  map?.remove()
  map = null
  layers = null
  drawLayer = null
})

watch(() => props.points, () => draw())
watch(() => props.checkpoints, () => draw())
watch(() => props.path, (v) => syncPath(v || []), { deep: true })

defineExpose({ undo, closeLoop, clearDraft, fitAll, lengthText, setBase })
</script>

<template>
  <div class="tmap" :style="{ height: `${height}px` }">
    <div ref="el" class="tmap__canvas"></div>

    <div class="tmap__toolbar">
      <template v-if="drawable">
        <button type="button" class="tmap__btn" title="撤销上一个点" @click="undo">撤销</button>
        <button type="button" class="tmap__btn" title="把终点连回起点" @click="closeLoop">闭合</button>
        <button type="button" class="tmap__btn" title="清空路径" @click="clearDraft">清空</button>
        <button type="button" class="tmap__btn" title="缩放到全部内容" @click="fitAll">全图</button>
      </template>
      <span class="tmap__sep"></span>
      <button
        v-for="b in BASE_LAYERS"
        :key="b.key"
        type="button"
        class="tmap__btn"
        :class="{ 'is-on': baseKey === b.key }"
        :title="`切换到${b.label}底图`"
        @click="setBase(b.key)"
      >
        {{ b.label }}
      </button>
      <span v-if="lengthText" class="tmap__len">{{ lengthText }}</span>
    </div>

    <div v-if="tileBroken" class="tmap__warn">
      <span class="tmap__warn-text">底图瓦片加载失败，路径仍可正常绘制与提交</span>
    </div>

    <div v-if="points.length >= 2 && showSpeed" class="tmap__legend">
      <span v-for="stop in SPEED_STOPS" :key="stop.label" class="tmap__legend-item">
        <i class="tmap__swatch" :style="{ background: stop.color }"></i>
        {{ stop.label }}
      </span>
      <span class="tmap__legend-unit">m/s</span>
    </div>

    <div v-if="loading" class="tmap__overlay">
      <span class="tmap__overlay-text">加载中…</span>
    </div>
    <div
      v-else-if="points.length < 2 && (!drawable || drawn.length === 0)"
      class="tmap__overlay"
      :class="checkpoints.length ? 'tmap__overlay--hint' : 'tmap__overlay--empty'"
    >
      <span class="tmap__overlay-text">{{ drawable ? '在地图上依次点击，画出你想跑的路线' : emptyText }}</span>
    </div>
  </div>
</template>

<style scoped>
.tmap {
  position: relative;
  width: 100%;
  background: #eef2f6;
  overflow: hidden;
}

.tmap__canvas {
  position: absolute;
  inset: 0;
}

.tmap__toolbar {
  position: absolute;
  right: 12px;
  top: 12px;
  z-index: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.tmap__btn {
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--c-border);
  border-radius: 4px;
  background: #fff;
  color: var(--c-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;
}

.tmap__btn:hover {
  border-color: var(--c-border-strong);
  color: var(--c-text);
}

.tmap__btn.is-on {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: var(--c-primary-soft);
}

.tmap__sep {
  width: 1px;
  height: 18px;
  background: var(--c-border);
  margin: 0 2px;
}

.tmap__warn {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  z-index: 550;
  padding: 5px 10px;
  border: 1px solid var(--c-warning-border);
  background: var(--c-warning-soft);
  border-radius: var(--r-sm);
  pointer-events: none;
}

.tmap__warn-text {
  font-size: 11px;
  color: var(--c-warning);
}

.tmap__len {
  padding: 0 6px;
  font-size: 11px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.tmap__legend {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 500;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  font-size: 11px;
  color: var(--c-text-2);
}

.tmap__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.tmap__swatch {
  width: 10px;
  height: 3px;
  border-radius: 2px;
}

.tmap__legend-unit {
  color: var(--c-text-3);
}

.tmap__overlay {
  position: absolute;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(248, 250, 252, 0.72);
  pointer-events: none;
}

.tmap__overlay--empty {
  background: rgba(248, 250, 252, 0.86);
}

/* 有打卡点时别用整张白膜盖住地图，只留一条底部提示，圆点才看得见 */
.tmap__overlay--hint {
  background: transparent;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 14px;
}

.tmap__overlay--hint .tmap__overlay-text {
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.tmap__overlay-text {
  padding: 6px 12px;
  border-radius: var(--r-sm);
  background: #fff;
  border: 1px solid var(--c-border);
  font-size: 12px;
  color: var(--c-text-3);
}
</style>
