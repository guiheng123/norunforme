<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorText, fetchRecords, fetchTerms } from '../api'
import type { RecordPage, RunRecord, Term } from '../api/types'
import {
  fmtDistance,
  fmtDuration,
  fmtInt,
  fmtKm,
  fmtPaceOf,
  fmtShortDateTime,
  recordStatusOf,
} from '../lib/format'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiField from '../components/ui/UiField.vue'
import UiSkeleton from '../components/ui/UiSkeleton.vue'
import UiTable from '../components/ui/UiTable.vue'
import UiTag from '../components/ui/UiTag.vue'

const router = useRouter()

const PAGE_SIZE = 10

const terms = ref<Term[]>([])
const activeTerm = ref('')
const page = ref(1)
const data = ref<RecordPage | null>(null)
const loading = ref(true)
const termsLoading = ref(true)
const error = ref('')

const rows = computed<RunRecord[]>(() => data.value?.list ?? [])
const totalNum = computed(() => Number(data.value?.total_num ?? 0))
const totalPages = computed(() => Math.max(1, Math.ceil(totalNum.value / PAGE_SIZE)))

const columns = [
  { key: 'start_time', label: '开始时间', width: '140px' },
  { key: 'distance', label: '距离', width: '100px', align: 'right' as const },
  { key: 'used_time', label: '用时', width: '100px', align: 'right' as const },
  { key: 'pace', label: '配速', width: '100px', align: 'right' as const },
  { key: 'run_score', label: '评分', width: '90px', align: 'right' as const },
  { key: 'record_status', label: '状态', width: '92px', align: 'right' as const },
]

async function loadRecords(): Promise<void> {
  if (!activeTerm.value) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await fetchRecords(activeTerm.value, page.value, PAGE_SIZE)
    data.value = result.data
  } catch (e) {
    error.value = errorText(e)
    data.value = null
  } finally {
    loading.value = false
  }
}

async function loadTerms(): Promise<void> {
  termsLoading.value = true
  try {
    const result = await fetchTerms()
    terms.value = result.data
    activeTerm.value = result.data[0]?.term_id ?? ''
  } catch (e) {
    error.value = errorText(e)
  } finally {
    termsLoading.value = false
  }
}

async function bootstrap(): Promise<void> {
  loading.value = true
  await loadTerms()
  await loadRecords()
}

function onTermChange(): void {
  page.value = 1
  void loadRecords()
}

function goPage(target: number): void {
  if (target < 1 || target > totalPages.value || target === page.value) return
  page.value = target
  void loadRecords()
}

function openRecord(row: Record<string, unknown>): void {
  const id = String(row.id ?? '')
  if (id) router.push(`/records/${id}`)
}

onMounted(bootstrap)
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h2 class="page__title">跑步记录</h2>
        <p class="page__desc">按学期查询历史跑步记录，点击行查看轨迹详情</p>
      </div>
      <div class="page__actions">
        <UiButton variant="secondary" size="sm" :loading="loading" @click="loadRecords">刷新</UiButton>
      </div>
    </div>

    <UiCard flush>
      <div class="toolbar">
        <UiField label="学期" inline>
          <select
            v-model="activeTerm"
            class="sel term-select"
            :disabled="termsLoading || !terms.length"
            @change="onTermChange"
          >
            <option v-if="!terms.length" value="">暂无学期</option>
            <option v-for="term in terms" :key="term.term_id" :value="term.term_id">
              {{ term.term_name }}
            </option>
          </select>
        </UiField>

        <div class="summary">
          <div class="summary__item">
            <span class="summary__label">有效次数</span>
            <span class="summary__value">{{ fmtInt(data?.total_score_num ?? 0) }}</span>
          </div>
          <div class="summary__item">
            <span class="summary__label">总次数</span>
            <span class="summary__value">{{ fmtInt(data?.total_num ?? 0) }}</span>
          </div>
          <div class="summary__item">
            <span class="summary__label">有效公里</span>
            <span class="summary__value">
              {{ fmtDistance(data?.total_score_distance ?? 0) }}
            </span>
          </div>
          <div class="summary__item">
            <span class="summary__label">总公里</span>
            <span class="summary__value">{{ fmtDistance(data?.total_distance ?? 0) }}</span>
          </div>
        </div>
      </div>
    </UiCard>

    <UiCard flush title="记录列表" :desc="`共 ${fmtInt(totalNum)} 条`">
      <template #actions>
        <span class="pager__info">第 {{ page }} / {{ totalPages }} 页</span>
      </template>

      <div v-if="loading" class="state-block">
        <UiSkeleton :rows="6" :height="16" />
      </div>

      <div v-else-if="error" class="state-block">
        <p class="error-text">{{ error }}</p>
        <UiButton variant="primary" size="sm" @click="loadRecords">重试</UiButton>
      </div>

      <UiTable
        v-else
        :columns="columns"
        :rows="rows"
        clickable
        empty-text="该学期没有跑步记录"
        @row-click="openRecord"
      >
        <template #cell-start_time="{ value }">
          <span class="cell-muted">{{ fmtShortDateTime(value) }}</span>
        </template>
        <template #cell-distance="{ value }">{{ fmtKm(value) }}</template>
        <template #cell-used_time="{ value }">{{ fmtDuration(value) }}</template>
        <template #cell-pace="{ row }">{{ fmtPaceOf(row.distance, row.used_time) }}</template>
        <template #cell-run_score="{ value }">
          <span class="cell-strong">{{ value ?? '--' }}</span>
        </template>
        <template #cell-record_status="{ value }">
          <UiTag :tone="recordStatusOf(value).tone">{{ recordStatusOf(value).text }}</UiTag>
        </template>
        <template #empty>
          <p class="empty-text">该学期还没有跑步记录</p>
          <UiButton variant="primary" size="sm" @click="router.push('/simulate')">去模拟一次</UiButton>
        </template>
      </UiTable>

      <footer v-if="!loading && !error && totalNum > 0" class="pager">
        <span class="pager__info">共 {{ fmtInt(totalNum) }} 条 · 每页 {{ PAGE_SIZE }} 条</span>
        <div class="pager__controls">
          <UiButton variant="secondary" size="sm" :disabled="page <= 1" @click="goPage(page - 1)">
            上一页
          </UiButton>
          <UiButton
            variant="secondary"
            size="sm"
            :disabled="page >= totalPages"
            @click="goPage(page + 1)"
          >
            下一页
          </UiButton>
        </div>
      </footer>
    </UiCard>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 16px;
  flex-wrap: wrap;
}

.term-select {
  width: 240px;
}

.summary {
  display: flex;
  align-items: center;
  gap: 28px;
  flex-wrap: wrap;
}

.summary__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.summary__label {
  font-size: 11px;
  color: var(--c-text-3);
}

.summary__value {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.state-block {
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}

.error-text {
  font-size: 13px;
  color: var(--c-danger);
}

.empty-text {
  font-size: 13px;
  color: var(--c-text-3);
  margin-bottom: 10px;
}

.cell-muted {
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.cell-strong {
  font-weight: 500;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--c-border);
  flex-wrap: wrap;
}

.pager__info {
  font-size: 12px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.pager__controls {
  display: flex;
  gap: 8px;
}

@media (max-width: 1024px) {
  .toolbar {
    align-items: flex-start;
  }

  .term-select {
    width: 100%;
  }
}
</style>
