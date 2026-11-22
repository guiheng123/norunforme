<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorText, fetchRecordDetail } from '../api'
import type { RecordDetail } from '../api/types'
import { isDemoMode } from '../store'
import {
  fmtDateTime,
  fmtDuration,
  fmtInt,
  fmtKm,
  fmtPace,
  fmtPct,
  recordStatusOf,
} from '../lib/format'
import DiagList from '../components/DiagList.vue'
import DemoSchoolSwitch from '../components/DemoSchoolSwitch.vue'
import SpeedChart from '../components/SpeedChart.vue'
import TrackMap from '../components/TrackMap.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiSkeleton from '../components/ui/UiSkeleton.vue'
import UiTag from '../components/ui/UiTag.vue'

const route = useRoute()
const router = useRouter()

const recordId = String(route.params.id ?? '')

const detail = ref<RecordDetail | null>(null)
const loading = ref(true)
const error = ref('')

const record = computed(() => detail.value?.record ?? null)
const track = computed(() => detail.value?.track ?? null)
const stats = computed(() => track.value?.stats ?? null)

const speeds = computed(() => (track.value?.points ?? []).map((p) => Number(p.s) || 0))

const checkpointIdx = computed(() => {
  const list: number[] = []
  ;(track.value?.points ?? []).forEach((p, index) => {
    if (p.p !== undefined && p.p !== null) list.push(index)
  })
  return list
})

const diagPassed = computed(
  () => (track.value?.diagnostics ?? []).filter((item) => item.level === 'pass').length,
)

const status = computed(() => recordStatusOf(record.value?.record_status))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await fetchRecordDetail(recordId, new Date().getFullYear())
    detail.value = result.data
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

function onDemoSchoolChange(): void {
  detail.value = null
  void load()
}
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h2 class="page__title">{{ record?.title || '跑步记录详情' }}</h2>
        <p class="page__desc">
          {{ fmtDateTime(record?.start_time) }} · 记录编号 {{ recordId }}
        </p>
      </div>
      <div class="page__actions">
        <UiTag :tone="status.tone">{{ status.text }}</UiTag>
        <UiButton variant="secondary" size="sm" @click="router.push('/records')">返回列表</UiButton>
      </div>
    </div>

    <DemoSchoolSwitch v-if="isDemoMode()" @change="onDemoSchoolChange" />

    <UiCard v-if="loading" title="记录详情">
      <UiSkeleton :rows="5" :height="16" />
    </UiCard>

    <UiCard v-else-if="error" title="记录加载失败">
      <p class="error-text">{{ error }}</p>
      <template #footer>
        <UiButton variant="primary" @click="load">重试</UiButton>
      </template>
    </UiCard>

    <div v-else class="detail-grid">
      <UiCard title="轨迹" desc="按实时速度着色，圆点为跑区打卡点" flush>
        <TrackMap
          :points="track?.points ?? []"
          :checkpoints="track?.checkpoints ?? []"
          :height="520"
          empty-text="该记录没有可用的轨迹点"
        />
      </UiCard>

      <div class="detail-side">
        <UiCard title="指标">
          <div class="metrics">
            <div class="metric">
              <span class="metric__label">距离</span>
              <span class="metric__value">{{ fmtKm(stats?.distanceKm) }}<em>km</em></span>
            </div>
            <div class="metric">
              <span class="metric__label">时长</span>
              <span class="metric__value">{{ fmtDuration(stats?.durationSec) }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">配速</span>
              <span class="metric__value">{{ fmtPace(stats?.paceSecPerKm) }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">步数</span>
              <span class="metric__value">{{ fmtInt(record?.step_num) }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">评分</span>
              <span class="metric__value">{{ record?.run_score ?? '--' }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">打卡点</span>
              <span class="metric__value">
                {{ (track?.checkpoints ?? []).filter((c) => c.hit).length }}<em>个</em>
              </span>
            </div>
          </div>
        </UiCard>

        <UiCard title="速度曲线" :desc="`GPS 噪声 ${fmtPct(stats?.noisePct)}`">
          <SpeedChart :series="speeds" :checkpoints="checkpointIdx" :height="150" />
        </UiCard>

        <UiCard title="数据诊断" :desc="`${diagPassed} / ${track?.diagnostics.length ?? 0} 项通过`">
          <DiagList :items="track?.diagnostics ?? []" compact />
          <p class="diag-note">诊断基于轨迹的物理与统计特征，仅作参考，不作为判定依据。</p>
        </UiCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  align-items: start;
}

.detail-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 12px;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.metric__label {
  font-size: 11px;
  color: var(--c-text-3);
}

.metric__value {
  font-size: 17px;
  font-weight: 600;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.metric__value em {
  margin-left: 3px;
  font-style: normal;
  font-size: 11px;
  font-weight: 400;
  color: var(--c-text-3);
}

.diag-note {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--c-border);
  font-size: 11px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.error-text {
  font-size: 13px;
  color: var(--c-danger);
}

@media (max-width: 1280px) {
  .detail-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
