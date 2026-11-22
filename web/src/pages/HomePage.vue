<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorText, fetchRecords, fetchSession, fetchTerms, fetchZone } from '../api'
import type { RecordPage, RunRecord, Term, ZonePayload } from '../api/types'
import {
  fmtDistance,
  fmtDuration,
  fmtKm,
  fmtPace,
  fmtPaceOf,
  fmtShortDateTime,
  fmtWindowValue,
  recordStatusOf,
} from '../lib/format'
import { setProfile, isDemoMode, store } from '../store'
import UiButton from '../components/ui/UiButton.vue'
import DemoSchoolSwitch from '../components/DemoSchoolSwitch.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiSkeleton from '../components/ui/UiSkeleton.vue'
import UiStat from '../components/ui/UiStat.vue'
import UiStatus from '../components/ui/UiStatus.vue'
import UiTable from '../components/ui/UiTable.vue'
import UiTag from '../components/ui/UiTag.vue'

const router = useRouter()

const loading = ref(true)
const error = ref('')
const zone = ref<ZonePayload | null>(null)
const terms = ref<Term[]>([])
const records = ref<RunRecord[]>([])
const totals = ref<RecordPage | null>(null)

const profile = computed(() => store.profile)
const currentTerm = computed(() => terms.value[0] ?? null)

const validNum = computed(() => profile.value?.total_valid_num ?? totals.value?.total_score_num ?? 0)
const validDistance = computed(
  () => profile.value?.total_valid_distance ?? totals.value?.total_score_distance ?? 0,
)
const weekNum = computed(() => profile.value?.week_num ?? 0)
const pointCount = computed(() => zone.value?.checkpoints.length ?? zone.value?.rules.pointNumOnline ?? 0)

const rules = computed(() => zone.value?.rules ?? null)

const columns = [
  { key: 'start_time', label: '时间', width: '132px' },
  { key: 'title', label: '类型' },
  { key: 'distance', label: '距离', width: '96px', align: 'right' as const },
  { key: 'used_time', label: '用时', width: '96px', align: 'right' as const },
  { key: 'pace', label: '配速', width: '96px', align: 'right' as const },
  { key: 'record_status', label: '状态', width: '84px', align: 'right' as const },
]

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [zoneRes, termsRes] = await Promise.allSettled([fetchZone(), fetchTerms()])
    if (zoneRes.status === 'fulfilled') zone.value = zoneRes.value.data
    else throw zoneRes.reason

    terms.value = termsRes.status === 'fulfilled' ? termsRes.value.data : []
    const termId = terms.value[0]?.term_id
    if (termId) {
      const page = await fetchRecords(termId, 1, 8)
      records.value = page.data.list
      totals.value = page.data
    }

    if (!store.profile) {
      try {
        const sessionRes = await fetchSession()
        setProfile(sessionRes.data.profile)
      } catch {
      }
    }
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

function openRecord(row: Record<string, unknown>): void {
  const id = String(row.id ?? '')
  if (id) router.push(`/records/${id}`)
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h2 class="page__title">本学期概览</h2>
        <p class="page__desc">
          {{ currentTerm?.term_name || '未加载学期' }} · 数据来源：乐跑服务端
        </p>
      </div>
      <div class="page__actions">
        <UiButton variant="secondary" size="sm" :loading="loading" @click="load">刷新数据</UiButton>
      </div>
    </div>

    <DemoSchoolSwitch v-if="isDemoMode()" @change="load" />

    <template v-if="loading">
      <div class="grid-stats">
        <div v-for="i in 4" :key="i" class="skeleton-card">
          <UiSkeleton :rows="3" :height="12" />
        </div>
      </div>
      <UiCard title="最近记录">
        <UiSkeleton :rows="6" :height="16" />
      </UiCard>
    </template>

    <template v-else-if="error">
      <UiCard title="数据加载失败">
        <p class="error-text">{{ error }}</p>
        <template #footer>
          <UiButton variant="primary" @click="load">重试</UiButton>
        </template>
      </UiCard>
    </template>

    <template v-else>
      <div class="grid-stats">
        <UiStat label="有效次数" :value="validNum" unit="次" delta-label="本学期累计" />
        <UiStat label="有效公里" :value="fmtKm(validDistance)" unit="km" delta-label="本学期累计" />
        <UiStat label="本周次数" :value="weekNum" unit="次" :delta-label="`本周 ${fmtKm(profile?.week_distance)} km`" />
        <UiStat label="打卡点数" :value="pointCount" unit="个" :delta-label="`需经过 ${rules?.minLogNum ?? 0} 个`" />
      </div>

      <div class="grid-main">
        <UiCard title="最近记录" desc="按时间倒序，最多显示 8 条" flush>
          <template #actions>
            <UiButton variant="ghost" size="sm" @click="router.push('/records')">查看全部</UiButton>
          </template>
          <UiTable :columns="columns" :rows="records" clickable @row-click="openRecord">
            <template #cell-start_time="{ value }">
              <span class="cell-time">{{ fmtShortDateTime(value) }}</span>
            </template>
            <template #cell-title="{ value }">
              <span class="cell-title">{{ value || '跑步' }}</span>
            </template>
            <template #cell-distance="{ value }">
              {{ fmtKm(value) }}
            </template>
            <template #cell-used_time="{ value }">
              {{ fmtDuration(value) }}
            </template>
            <template #cell-pace="{ row }">
              {{ fmtPaceOf(row.distance, row.used_time) }}
            </template>
            <template #cell-record_status="{ value }">
              <UiTag :tone="recordStatusOf(value).tone">{{ recordStatusOf(value).text }}</UiTag>
            </template>
            <template #empty>
              <p class="empty-text">本学期还没有跑步记录</p>
              <UiButton variant="primary" size="sm" @click="router.push('/simulate')">去模拟一次</UiButton>
            </template>
          </UiTable>
        </UiCard>

        <UiCard title="跑区与规则" :desc="zone?.zone.name || '未加载'">
          <template #actions>
            <UiStatus
              v-if="rules"
              :tone="rules.isCheckTime ? 'success' : 'neutral'"
              :label="rules.isCheckTime ? '需校验时段' : '不校验时段'"
            />
          </template>

          <div v-if="rules" class="kv">
            <span class="kv__k">跑区编号</span>
            <span class="kv__v">{{ zone?.zone.id }}</span>

            <span class="kv__k">合格里程</span>
            <span class="kv__v">{{ rules.minDistanceKm }} – {{ rules.maxDistanceKm }} km</span>

            <span class="kv__k">配速区间</span>
            <span class="kv__v">{{ fmtPace(rules.maxPaceSec) }} – {{ fmtPace(rules.minPaceSec) }}</span>

            <span class="kv__k">时间窗</span>
            <span class="kv__v">
              {{ fmtWindowValue(rules.runStartTime) }} – {{ fmtWindowValue(rules.runEndTime) }}
            </span>

            <span class="kv__k">打卡点</span>
            <span class="kv__v">{{ zone?.checkpoints.length ?? 0 }} 个 · 需经过 {{ rules.minLogNum }} 个</span>

            <span class="kv__k">在线打卡位</span>
            <span class="kv__v">{{ rules.pointNumOnline }} 个</span>

            <span class="kv__k">本学期有效</span>
            <span class="kv__v">{{ fmtDistance(validDistance) }} / {{ validNum }} 次</span>

            <span class="kv__k">总里程</span>
            <span class="kv__v">{{ fmtDistance(totals?.total_distance) }}</span>
          </div>
          <p v-else class="empty-text">暂无跑区规则</p>
        </UiCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.grid-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.skeleton-card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  padding: 16px;
}

.grid-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
  align-items: start;
}

.cell-time {
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.cell-title {
  color: var(--c-text);
}

.empty-text {
  font-size: 13px;
  color: var(--c-text-3);
  margin-bottom: 10px;
}

.error-text {
  font-size: 13px;
  color: var(--c-danger);
  line-height: 1.6;
}

@media (max-width: 1280px) {
  .grid-main {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1024px) {
  .grid-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
