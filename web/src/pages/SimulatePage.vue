<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { errorHint, errorText, fetchSubmit, fetchZone, previewTrack, submitTrack } from '../api'
import type {
  PreviewRequest,
  PreviewResponse,
  SubmitStatus,
  TrackCheckpoint,
  ZoneCheckpoint,
} from '../api/types'
import {
  fmtDuration,
  fmtFixed,
  fmtInt,
  fmtKm,
  fmtPace,
  fmtPct,
  paceToInput,
  parsePace,
} from '../lib/format'
import { setPreviewCache, isDemoMode, store } from '../store'
import { demoSchoolByKey } from '../lib/demo'
import { toast } from '../lib/toast'
import DiagList from '../components/DiagList.vue'
import DemoSchoolSwitch from '../components/DemoSchoolSwitch.vue'
import TrackMap from '../components/TrackMap.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiField from '../components/ui/UiField.vue'
import UiModal from '../components/ui/UiModal.vue'
import UiSkeleton from '../components/ui/UiSkeleton.vue'
import UiStatus from '../components/ui/UiStatus.vue'
import UiTag from '../components/ui/UiTag.vue'

const router = useRouter()

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toLocalTs(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(text || '')
  if (!m) return NaN
  const [, y, mo, d, h, mi, se] = m
  return Math.floor(new Date(
    Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se || 0),
  ).getTime() / 1000)
}

function toLocalInputSec(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const MIN_KM = 1.5
const MAX_KM = 10
const MIN_PACE = 180
const MAX_PACE = 540

const targetKm = ref(3)
const paceSec = ref(330)
const paceText = ref(paceToInput(330))
const seedInput = ref('')
const radius = ref(25)
const noisePct = ref(8)
const startAt = ref(toLocalInputSec(new Date()))

const startMode = ref<'now' | 'at'>('now')

const nowAnchor = ref('')

function onStartInput(): void {
  startMode.value = startAt.value === nowAnchor.value ? 'now' : 'at'
  timeHintStale.value = Boolean(preview.value)
}

watch(startAt, (v) => {
  startMode.value = v === nowAnchor.value ? 'now' : 'at'
})

const timeHintStale = ref(false)

function setStartOffset(minutes: number): void {
  const next = toLocalInputSec(new Date(Date.now() + minutes * 60000))
  startAt.value = next
  if (minutes === 0) {
    nowAnchor.value = next
    startMode.value = 'now'
  } else {
    startMode.value = 'at'
  }
  timeHintStale.value = Boolean(preview.value)
}

const startAtHint = computed(() => {
  const prefix = startMode.value === 'now' ? '［现在模式］' : '［指定时刻］'
  const ts = toLocalTs(startAt.value)
  if (timeHintStale.value && Number.isFinite(ts)) {
    return `${prefix}开始时间已改为 ${startAt.value.replace('T', ' ')}：提交时按新时间计算，点「生成轨迹」可先刷新停表时刻`
  }
  const tc = preview.value?.timeCheck
  if (tc) return `${prefix}${tc.note}`
  if (!Number.isFinite(ts)) return '选择开跑时刻；停表时刻 = 开跑 + 用时 + 115 s'
  return startMode.value === 'now'
    ? '［现在模式］以当前时刻为锚倒推（停表 = 现在）；手填时间会切到「指定时刻」，那时按你填的算'
    : '［指定时刻］已手动指定开始时间，点「生成轨迹」后显示预计停表时刻'
})

const draftPath = ref<Array<[number, number]>>([])
const drawMode = ref(false)
const mapRef = ref<{ undo: () => void; closeLoop: () => void; clearDraft: () => void; fitAll: () => void } | null>(null)

const zoneCheckpoints = ref<ZoneCheckpoint[]>([])
const selectedIds = ref<string[]>([])

async function loadZone(): Promise<void> {
  try {
    const result = await fetchZone()
    zoneCheckpoints.value = result.data.checkpoints ?? []
  } catch {
    zoneCheckpoints.value = []
  }
}

function toggleCheckpoint(id: string): void {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) selectedIds.value.splice(idx, 1)
  else selectedIds.value.push(id)
}

function clearCheckpointPick(): void {
  selectedIds.value = []
}

function onPathUpdate(next: Array<[number, number]>): void {
  draftPath.value = next
}

function clearPath(): void {
  draftPath.value = []
  mapRef.value?.clearDraft()
}

function onDemoSchoolChange(): void {
  const school = demoSchoolByKey(store.demoSchool)
  preview.value = null
  setPreviewCache(null)
  selectedIds.value = []
  draftPath.value = []
  generateError.value = ''
  generateHint.value = ''
  mapRef.value?.clearDraft()
  void loadZone()
  toast(`已切换到 ${school.name}，重新绘制路线后会按该校跑区生成轨迹`, 'info')
}

const pacePresets = [270, 300, 330, 360, 390]

watch(paceSec, (value) => {
  const next = paceToInput(value)
  if (parsePace(paceText.value) !== value) paceText.value = next
})

function setPace(value: number): void {
  paceSec.value = clamp(Math.round(value), MIN_PACE, MAX_PACE)
  paceText.value = paceToInput(paceSec.value)
}

function onPaceTextChange(): void {
  const parsed = parsePace(paceText.value)
  if (parsed === null) {
    paceText.value = paceToInput(paceSec.value)
    return
  }
  setPace(parsed)
}

function randomSeed(): void {
  seedInput.value = String(Math.floor(Math.random() * 900000) + 100000)
}

const preview = ref<PreviewResponse | null>(null)
const generating = ref(false)
const generateError = ref('')
const generateHint = ref('')
const previewAt = ref<number>(0)

const mapCheckpoints = computed<TrackCheckpoint[]>(() => {
  const list = preview.value?.checkpoints
  if (list && list.length) {
    return list.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, hit: c.hit }))
  }
  return zoneCheckpoints.value.map((c) => ({
    id: c.id,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    hit: false,
  }))
})

const speeds = computed(() => (preview.value?.points ?? []).map((p) => Number(p.s) || 0))

const checkpointIdx = computed(() => {
  const list: number[] = []
  ;(preview.value?.points ?? []).forEach((point, index) => {
    if (point.p !== undefined && point.p !== null) list.push(index)
  })
  return list
})

const hitCount = computed(
  () => (preview.value?.checkpoints ?? []).filter((item) => item.hit).length,
)

function signedKm(value: number): string {
  if (!Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}`
}

const statItems = computed(() => {
  const stats = preview.value?.stats
  const total = preview.value?.checkpoints.length ?? 0
  const passed = (preview.value?.diagnostics ?? []).filter((item) => item.level === 'pass').length
  const diagTotal = preview.value?.diagnostics.length ?? 0
  const distance = Number(stats?.distanceKm ?? 0)
  const duration = Number(stats?.durationSec ?? 0)
  return [
    { label: '实测距离', value: fmtKm(stats?.distanceKm), unit: 'km' },
    { label: '用时', value: fmtDuration(stats?.durationSec), unit: '' },
    { label: '平均配速', value: fmtPace(stats?.paceSecPerKm), unit: '/km' },
    { label: '轨迹点', value: fmtInt(stats?.pointCount), unit: '个' },
    { label: '平均速度', value: fmtFixed(stats?.avgSpeed, 2), unit: 'm/s' },
    { label: '最高速度', value: fmtFixed(stats?.maxSpeed, 2), unit: 'm/s' },
    { label: 'GPS 噪声', value: fmtPct(stats?.noisePct), unit: '' },
    { label: '目标里程', value: fmtKm(Number(targetKm.value)), unit: 'km' },
    { label: '里程偏差', value: signedKm(distance - Number(targetKm.value)), unit: 'km' },
    { label: '打卡命中', value: `${hitCount.value}/${total}`, unit: '个' },
    { label: '诊断通过', value: `${passed}/${diagTotal}`, unit: '项' },
    { label: '预估步数', value: fmtInt((duration * 176) / 60), unit: '步' },
  ]
})

const verdict = computed(() => preview.value?.verdict ?? null)

const noiseActual = computed(() => preview.value?.noiseActual ?? null)

async function generate(): Promise<void> {
  if (generating.value) return
  if (draftPath.value.length < 2) {
    toast('请先在地图上绘制路径（至少 2 个点）', 'warning')
    return
  }
  generating.value = true
  generateError.value = ''
  generateHint.value = ''
  try {
    const body: PreviewRequest = {
      targetKm: clamp(Number(targetKm.value) || MIN_KM, MIN_KM, MAX_KM),
      paceSec: clamp(Number(paceSec.value) || 330, MIN_PACE, MAX_PACE),
      seed: seedInput.value.trim() === '' ? null : Number(seedInput.value),
      startAt: startAt.value || toLocalInputSec(new Date()),
      startMode: startMode.value,
      path: draftPath.value,
      radius: radius.value,
      noisePct: noisePct.value,
      mustHit: selectedIds.value.length ? selectedIds.value : undefined,
    }
    const result = await previewTrack(body)
    preview.value = result.data
    timeHintStale.value = false
    if (!selectedIds.value.length && result.data.anchored?.length) {
      selectedIds.value = result.data.anchored.map((x) => x.id)
    }
    previewAt.value = Date.now()
    setPreviewCache({
      points: result.data.points,
      checkpoints: result.data.checkpoints,
      stats: result.data.stats,
      diagnostics: result.data.diagnostics,
      verdict: result.data.verdict,
      createdAt: Date.now(),
      params: {
        targetKm: body.targetKm,
        paceSec: body.paceSec,
        seed: body.seed,
        startAt: body.startAt,
        startMode: startMode.value,
        radius: radius.value,
        noisePct: noisePct.value,
      },
    })
    toast(
      result.data.verdict.pass ? '轨迹已生成，判定通过' : '轨迹已生成，' + result.data.verdict.reasons.length + ' 项未通过',
      result.data.verdict.pass ? 'success' : 'warning',
    )
  } catch (e) {
    generateError.value = errorText(e)
    generateHint.value = errorHint(e)
  toast(`生成失败：${errorText(e)}`, 'danger')
  } finally {
    generating.value = false
  }
}

const modalOpen = ref(false)
const submitting = ref(false)
const submitError = ref('')
const submitHint = ref('')
const submitId = ref('')
const submitStatus = ref<SubmitStatus | null>(null)
let pollTimer: number | undefined

function stopPolling(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer)
    pollTimer = undefined
  }
}

async function pollOnce(): Promise<SubmitStatus | null> {
  if (!submitId.value) return null
  try {
    const result = await fetchSubmit(submitId.value)
    submitStatus.value = result.data
    return result.data
  } catch (e) {
    submitError.value = errorText(e)
    submitHint.value = errorHint(e)
    stopPolling()
    return null
  }
}

function startPolling(): void {
  stopPolling()
  pollTimer = window.setInterval(() => {
    void pollOnce().then((state) => {
      if (!state || state.state !== 'running') stopPolling()
    })
  }, 700)
}

async function runSubmit(): Promise<void> {
  if (!preview.value) return
  stopPolling()
  submitting.value = true
  submitError.value = ''
  submitHint.value = ''
  submitId.value = ''
  submitStatus.value = null
  try {
    const result = await submitTrack({
      points: preview.value.points,
      checkpoints: preview.value.checkpoints,
      meta: {
        targetKm: Number(targetKm.value),
        paceSec: Number(paceSec.value),
        seed: seedInput.value.trim() === '' ? null : Number(seedInput.value),
        startAt: startAt.value,
        startTs: toLocalTs(startAt.value),
        startMode: startMode.value,
        radius: Number(radius.value),
        pinned: (preview.value?.anchored ?? []).map((x) => x.id).length
          ? (preview.value?.anchored ?? []).map((x) => x.id)
          : (preview.value?.pinned ?? []).map((x: { id: string }) => x.id),
        mobileModel: store.settings.mobileModel,
        mobileDeviceId: store.settings.mobileDeviceId,
        mobileOsVersion: store.settings.mobileOsVersion,
        source: 'web-console',
      },
    })
    submitId.value = result.data.submitId
    const first = await pollOnce()
    if (!first || first.state === 'running') startPolling()
  } catch (e) {
    submitError.value = errorText(e)
    submitHint.value = errorHint(e)
  } finally {
    submitting.value = false
  }
}

function openSubmit(): void {
  if (!preview.value) {
    toast('请先在地图上绘制路径', 'warning')
    return
  }
  modalOpen.value = true
  void runSubmit()
}

function closeModal(): void {
  modalOpen.value = false
  stopPolling()
}

const submitTone = computed(() => {
  if (submitError.value) return 'danger' as const
  if (!submitStatus.value) return 'primary' as const
  if (submitStatus.value.state === 'failed') return 'danger' as const
  if (submitStatus.value.state === 'done') return submitStatus.value.verdict.pass ? ('success' as const) : ('warning' as const)
  return 'primary' as const
})

const submitLabel = computed(() => {
  if (submitError.value) return '链路中断'
  if (!submitStatus.value) return '待提交'
  if (submitStatus.value.state === 'running') return '执行中'
  if (submitStatus.value.state === 'failed') return '提交失败'
  return submitStatus.value.verdict.pass ? '提交成功' : '提交完成 · 待复核'
})

function stepTone(state: string): 'success' | 'danger' | 'neutral' {
  if (state === 'ok') return 'success'
  if (state === 'fail') return 'danger'
  return 'neutral'
}

function stepText(state: string): string {
  if (state === 'ok') return '成功'
  if (state === 'fail') return '失败'
  return '跳过'
}

onMounted(() => {
  void loadZone()
  const cached = store.preview
  if (!cached) return
  preview.value = {
    points: cached.points,
    checkpoints: cached.checkpoints,
    stats: cached.stats,
    diagnostics: cached.diagnostics,
    verdict: cached.verdict,
  }
  previewAt.value = cached.createdAt
  targetKm.value = cached.params.targetKm
  paceSec.value = cached.params.paceSec
  paceText.value = paceToInput(cached.params.paceSec)

  radius.value = cached.params.radius
  if (typeof cached.params.noisePct === 'number') noisePct.value = cached.params.noisePct
  const cachedMode = cached.params.startMode === 'at' ? 'at' : 'now'
  nowAnchor.value = cachedMode === 'now' ? cached.params.startAt : ''
  startAt.value = cached.params.startAt
  startMode.value = cachedMode
  seedInput.value = cached.params.seed === null ? '' : String(cached.params.seed)
})

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h2 class="page__title">模拟跑步</h2>
        <p class="page__desc">在地图上手绘路线，按目标里程与配速生成轨迹，预览后提交</p>
      </div>
      <div class="page__actions">
        <UiButton variant="ghost" size="sm" @click="router.push('/device')">前往设备控制台</UiButton>
      </div>
    </div>

    <DemoSchoolSwitch v-if="isDemoMode()" @change="onDemoSchoolChange" />

    <div v-if="generateError" class="alert">
      <span class="alert__text">{{ generateError }}</span>
      <span v-if="generateHint" class="alert__hint">{{ generateHint }}</span>
    </div>

    <div class="sim-grid">
      <UiCard class="area-params" title="参数" desc="范围由跑区规则限定">
        <div class="form">
          <div class="field-block">
            <div class="field-head">
              <span class="field-label">目标里程</span>
              <span class="field-value">{{ fmtKm(Number(targetKm)) }} km</span>
            </div>
            <input v-model.number="targetKm" class="range" type="range" :min="MIN_KM" :max="MAX_KM" step="0.1" />
            <div class="field-foot">
              <span class="field-hint">1.5 ~ 10.0 km</span>
              <input v-model.number="targetKm" class="inp field-input" type="number" :min="MIN_KM" :max="MAX_KM" step="0.1" />
            </div>
          </div>

          <div class="field-block">
            <div class="field-head">
              <span class="field-label">目标配速</span>
              <span class="field-value">{{ fmtPace(paceSec) }}</span>
            </div>
            <input
              class="range"
              type="range"
              :min="MIN_PACE"
              :max="MAX_PACE"
              step="5"
              :value="paceSec"
              @input="setPace(Number(($event.target as HTMLInputElement).value))"
            />
            <div class="field-foot">
              <span class="field-hint">3'00" ~ 9'00"</span>
              <input
                v-model="paceText"
                class="inp field-input"
                type="text"
                inputmode="numeric"
                @change="onPaceTextChange"
                @blur="onPaceTextChange"
              />
            </div>
            <div class="chips">
              <button
                v-for="preset in pacePresets"
                :key="preset"
                type="button"
                class="chip"
                :class="{ 'is-active': paceSec === preset }"
                @click="setPace(preset)"
              >
                {{ fmtPace(preset) }}
              </button>
            </div>
          </div>

          <UiField label="随机种子" hint="留空则由服务端随机，同一种子可复现同一轨迹">
            <div class="inline-row">
              <input v-model="seedInput" class="inp" type="number" placeholder="留空随机" />
              <UiButton variant="secondary" size="sm" @click="randomSeed">随机</UiButton>
            </div>
          </UiField>

          <div class="field-block">
            <div class="field-head">
              <span class="field-label">判定半径</span>
              <span class="field-value">{{ radius }} m</span>
            </div>
            <input v-model.number="radius" class="range" type="range" min="10" max="80" step="5" />
            <div class="field-foot">
              <span class="field-hint">10 ~ 80 m，随 meta 一起提交</span>
            </div>
          </div>

          <div class="field-block">
            <div class="field-head">
              <span class="field-label">GPS 噪声</span>
              <span class="field-value">{{ noisePct }}%</span>
            </div>
            <input v-model.number="noisePct" class="range" type="range" min="0" max="45" step="1" />
            <div class="field-foot">
              <span class="field-hint">
                抖动使里程放大的比例；真实记录约 5%~15%。设为 0 表示不加人为抖动，
                路线本身有弯时诊断里仍会显示约 2%~3% 底噪。
              </span>
              <span v-if="noiseActual !== null" class="field-hint">本次实际 {{ noiseActual }}%</span>
            </div>
          </div>

          <UiField
            label="开始时间"
            :hint="startAtHint"
          >
            <input v-model="startAt" class="inp" type="datetime-local" @input="onStartInput" @change="onStartInput" />
            <div class="inline-row start-row">
              <button
                type="button"
                class="chip"
                :class="{ 'is-active': startMode === 'now' }"
                @click="setStartOffset(0)"
              >
                现在
              </button>
              <button type="button" class="chip" @click="setStartOffset(-30)">30 分钟前</button>
              <button type="button" class="chip" @click="setStartOffset(-90)">90 分钟前</button>
            </div>
          </UiField>

          <div class="field-block">
            <div class="field-head">
              <span class="field-label">必须打卡的点</span>
              <span class="field-value">
                {{ selectedIds.length ? `${selectedIds.length} 个` : '自动选 2 个' }}
              </span>
            </div>
            <div class="chips chips--cps">
              <button
                v-for="cp in zoneCheckpoints"
                :key="cp.id"
                type="button"
                class="chip"
                :class="{ 'is-active': selectedIds.includes(cp.id) }"
                :title="cp.name"
                @click="toggleCheckpoint(cp.id)"
              >
                {{ cp.name }}
              </button>
              <button
                v-if="selectedIds.length"
                type="button"
                class="chip chip--ghost"
                @click="clearCheckpointPick"
              >
                自动
              </button>
            </div>
            <div class="field-foot">
              <span class="field-hint">
                轨迹会在所选打卡点坐标上精确落脚并驻留若干帧（服务端按「真的跑过」判定）
              </span>
            </div>
          </div>
        </div>

        <template #footer>
          <span class="foot-note">生成后可在右侧查看结果</span>
        </template>
      </UiCard>

      <UiCard class="area-map" title="轨迹预览" desc="在地图上依次点击绘制路线；圆点为打卡点" flush>
        <template #actions>
          <UiTag tone="neutral">{{ fmtKm(preview?.stats.distanceKm) }} km</UiTag>
          <UiTag tone="primary">{{ hitCount }}/{{ preview?.checkpoints.length ?? 0 }} 命中</UiTag>
          <UiTag v-if="preview?.mode === 'manual'" tone="neutral">手绘 · {{ preview?.pathLengthM }} m</UiTag>
          <UiTag v-if="preview?.playSec" tone="neutral">注入 {{ preview?.playSec }}s</UiTag>
          <UiTag v-if="preview?.anchored?.length" tone="primary">钉住 {{ preview?.anchored?.length }} 点</UiTag>
          <UiTag v-if="noiseActual !== null" tone="neutral">噪声 {{ noiseActual }}%</UiTag>
          <UiTag v-if="preview?.missed?.length" tone="warning">未覆盖 {{ preview?.missed?.length }} 点</UiTag>
          <UiTag v-if="draftPath.length" tone="neutral">手绘 {{ draftPath.length }} 点</UiTag>
          <UiButton v-if="draftPath.length" size="sm" variant="ghost" @click="clearPath">清除手绘</UiButton>
        </template>
        <TrackMap
          ref="mapRef"
          drawable
          :path="draftPath"
          @update:path="onPathUpdate"
          :points="preview?.points ?? []"
          :checkpoints="mapCheckpoints"
          :height="520"
          :loading="generating"
          empty-text="尚未生成轨迹"
        />
      </UiCard>

      <UiCard class="area-result" title="运行结果">
        <template #actions>
          <UiStatus
            v-if="verdict"
            :tone="verdict.pass ? 'success' : 'danger'"
            :label="verdict.pass ? '判定通过' : '判定未通过'"
          />
        <UiTag v-else tone="neutral">未生成</UiTag>
        </template>

        <div v-if="!preview" class="result-empty">
          <p class="result-empty__text">尚未生成轨迹</p>
        <p class="result-empty__hint">设置左侧参数后点击「生成轨迹」</p>
        </div>

        <template v-else>
          <div class="stat-grid">
            <div v-for="item in statItems" :key="item.label" class="stat-item">
              <span class="stat-item__label">{{ item.label }}</span>
              <span class="stat-item__value">
                {{ item.value }}<em v-if="item.unit">{{ item.unit }}</em>
              </span>
            </div>
          </div>

          <div v-if="verdict && !verdict.pass && verdict.reasons.length" class="reasons">
          <p class="reasons__title">未通过原因</p>
            <p v-for="(reason, index) in verdict.reasons" :key="index" class="reasons__item">{{ reason }}</p>
          </div>

          <div class="diag-block">
            <div class="diag-block__head">
              <span class="diag-block__title">数据诊断</span>
              <span class="diag-block__meta">{{ preview.diagnostics.filter((d) => d.level === 'pass').length }} / {{ preview.diagnostics.length }} 项通过</span>
            </div>
            <DiagList :items="preview.diagnostics" compact />
          </div>
        </template>
      </UiCard>
    </div>

    <div class="actions">
      <span class="actions__hint">
        {{ previewAt ? '参数变更后需重新生成轨迹' : '生成轨迹后才能提交' }}
      </span>
      <UiButton variant="primary" :loading="generating" :disabled="draftPath.length < 2" @click="generate">生成轨迹</UiButton>
      <UiButton variant="secondary" :disabled="!preview || generating" @click="openSubmit">提交到服务器</UiButton>
    </div>

    <UiModal :open="modalOpen" title="提交到服务器" :width="640" @close="closeModal">
      <div class="submit">
        <div class="submit__head">
          <UiStatus :tone="submitTone" :label="submitLabel" />
          <span v-if="submitId" class="submit__id u-mono">任务 {{ submitId }}</span>
        </div>

        <div v-if="submitError" class="submit__error">
          <p class="submit__error-text">{{ submitError }}</p>
          <p v-if="submitHint" class="submit__error-hint">{{ submitHint }}</p>
        </div>

        <ol v-if="submitStatus" class="steps">
          <li v-for="(step, index) in submitStatus.steps" :key="step.step" class="step">
            <span class="step__index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="step__label">{{ step.label }}</span>
            <UiTag :tone="stepTone(step.state)">{{ stepText(step.state) }}</UiTag>
            <span class="step__ms">{{ step.ms }} ms</span>
            <span class="step__detail">{{ step.detail }}</span>
          </li>
        </ol>

        <div v-else-if="submitting" class="submit__skeleton">
          <UiSkeleton :rows="3" :height="14" />
        </div>

        <div v-if="submitStatus && submitStatus.state !== 'running'" class="submit__verdict">
          <UiStatus
            :tone="submitStatus.verdict.pass ? 'success' : 'warning'"
            :label="submitStatus.verdict.pass ? '服务端判定通过' : '服务端判定待复核'"
          />
          <p v-for="(reason, index) in submitStatus.verdict.reasons" :key="index" class="submit__reason">
            {{ reason }}
          </p>
        </div>
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="closeModal">关闭</UiButton>
        <UiButton v-if="submitError" variant="primary" :loading="submitting" @click="runSubmit">重试</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.sim-grid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 340px;
  grid-template-areas: 'params map result';
  gap: 16px;
  align-items: start;
}

.area-params {
  grid-area: params;
}

.area-map {
  grid-area: map;
}

.area-result {
  grid-area: result;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-label);
}

.field-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.field-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.field-hint {
  font-size: 11px;
  color: var(--c-text-3);
}

.field-input {
  width: 84px;
  height: 28px;
  text-align: right;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-surface);
  font-size: 11px;
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
  transition: border-color var(--t), color var(--t), background-color var(--t);
}

.chip:hover {
  border-color: var(--c-border-strong);
}

.chip.is-active {
  border-color: var(--c-primary-border);
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.chips--cps {
  max-height: 132px;
  overflow-y: auto;
}

.chips--cps .chip {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip--ghost {
  border-style: dashed;
  color: var(--c-text-3);
}

.seg {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  background: var(--c-surface-2);
  width: 100%;
}

.seg__btn {
  flex: 1;
  height: 28px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--c-text-2);
  transition: background-color var(--t), color var(--t);
}

.seg__btn.is-active {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-text);
  font-weight: 500;
}

.inline-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.start-row {
  margin-top: 6px;
  gap: 6px;
}

.foot-note {
  font-size: 11px;
  color: var(--c-text-3);
}

.result-empty {
  padding: 48px 8px;
  text-align: center;
}

.result-empty__text {
  font-size: 13px;
  color: var(--c-text-2);
}

.result-empty__hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--c-text-3);
}

.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 10px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.stat-item__label {
  font-size: 11px;
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-item__value {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.stat-item__value em {
  margin-left: 3px;
  font-style: normal;
  font-size: 10px;
  font-weight: 400;
  color: var(--c-text-3);
}

.reasons {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--c-danger-border);
  border-radius: var(--r);
  background: var(--c-danger-soft);
}

.reasons__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-danger);
  margin-bottom: 4px;
}

.reasons__item {
  font-size: 12px;
  line-height: 1.6;
  color: #b91c1c;
}

.diag-block {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--c-border);
}

.diag-block__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.diag-block__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text);
}

.diag-block__meta {
  font-size: 11px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 4px;
  border-top: 1px solid var(--c-border);
}

.actions__hint {
  margin-right: auto;
  font-size: 12px;
  color: var(--c-text-3);
}

.alert {
  padding: 10px 12px;
  border: 1px solid var(--c-danger-border);
  border-radius: var(--r);
  background: var(--c-danger-soft);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.alert__text {
  font-size: 12px;
  color: var(--c-danger);
}

.alert__hint {
  font-size: 11px;
  color: var(--c-text-3);
}

.submit {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.submit__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.submit__id {
  font-size: 11px;
  color: var(--c-text-3);
}

.submit__error {
  padding: 10px 12px;
  border: 1px solid var(--c-danger-border);
  border-radius: var(--r);
  background: var(--c-danger-soft);
}

.submit__error-text {
  font-size: 12px;
  color: var(--c-danger);
}

.submit__error-hint {
  margin-top: 2px;
  font-size: 11px;
  color: var(--c-text-3);
}

.steps {
  display: flex;
  flex-direction: column;
}

.step {
  display: grid;
  grid-template-columns: 26px 1fr auto 64px;
  gap: 8px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f1f5f9;
}

.step:last-child {
  border-bottom: none;
}

.step__index {
  font-size: 11px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.step__label {
  font-size: 13px;
  color: var(--c-text);
}

.step__ms {
  font-size: 11px;
  color: var(--c-text-3);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.step__detail {
  grid-column: 2 / -1;
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-3);
}

.submit__skeleton {
  padding: 8px 0;
}

.submit__verdict {
  padding-top: 10px;
  border-top: 1px solid var(--c-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.submit__reason {
  font-size: 12px;
  color: var(--c-text-2);
}

@media (max-width: 1440px) {
  .sim-grid {
    grid-template-columns: 300px minmax(0, 1fr);
    grid-template-areas:
      'params map'
      'params result';
  }

  .area-result {
    min-height: 0;
  }
}

@media (max-width: 1100px) {
  .sim-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'params'
      'map'
      'result';
  }
}
</style>
