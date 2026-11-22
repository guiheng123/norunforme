<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  errorText,
  fetchDeviceRun,
  fetchDeviceStatus,
  startDeviceRun,
  startFrida,
  stopDeviceRun,
  stopFrida,
} from '../api'
import type { DeviceRunState, DeviceStatus } from '../api/types'
import { fmtClock, fmtDistance, fmtDuration, fmtInt, fmtWindowValue } from '../lib/format'
import { store } from '../store'
import { toast } from '../lib/toast'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiSkeleton from '../components/ui/UiSkeleton.vue'
import UiStatus from '../components/ui/UiStatus.vue'
import UiTag from '../components/ui/UiTag.vue'

const router = useRouter()

const status = ref<DeviceStatus | null>(null)
const statusLoading = ref(true)
const statusError = ref('')

const runId = ref('')
const runState = ref<DeviceRunState | null>(null)
const starting = ref(false)
const stopping = ref(false)
const runError = ref('')

let pollTimer: number | undefined

const preview = computed(() => store.preview)
const hasPoints = computed(() => (preview.value?.points.length ?? 0) > 1)

const running = computed(() => runState.value?.state === 'running')
const total = computed(() => Number(runState.value?.total ?? 0))
const injected = computed(() => Number(runState.value?.injected ?? 0))
const percent = computed(() => (total.value > 0 ? Math.min(100, (injected.value / total.value) * 100) : 0))
const remaining = computed(() => Math.max(0, total.value - injected.value))

const expectedKm = computed(() => Number(preview.value?.stats.distanceKm ?? 0))
const remainingKm = computed(() =>
  Math.max(0, expectedKm.value - Number(runState.value?.distanceKm ?? 0)),
)

const runLabel = computed(() => {
  const state = runState.value?.state
  if (state === 'running') return '注入中'
  if (state === 'done') return '已完成'
  if (state === 'stopped') return '已停止'
  if (state === 'failed') return '失败'
  return '空闲'
})

const runTone = computed(() => {
  const state = runState.value?.state
  if (state === 'running') return 'primary' as const
  if (state === 'done') return 'success' as const
  if (state === 'failed') return 'danger' as const
  if (state === 'stopped') return 'warning' as const
  return 'neutral' as const
})

const fridaBusy = ref(false)

const ANALYSIS_KEYS = [
  { key: 'runner', label: 'runner.py' },
  { key: 'agent', label: 'amap3.js' },
  { key: 'feed', label: 'feed.sh' },
] as const
const analysisKnown = computed(() => Boolean(status.value?.analysis))
const analysisMissing = computed(() => {
  const a = status.value?.analysis
  if (!a) return []
  return ANALYSIS_KEYS.filter((x) => a[x.key] === false).map((x) => x.label)
})

async function startFridaServer(): Promise<void> {
  if (fridaBusy.value) return
  fridaBusy.value = true
  try {
    const r = await startFrida()
    if (r.data?.ready) toast('Frida 已就绪', 'success')
    else toast(`启动未完成：${r.data?.reason || '未知原因'}`, 'warning')
    await loadStatus()
  } catch (e) {
    toast(errorText(e), 'danger')
  } finally {
    fridaBusy.value = false
  }
}

async function stopFridaServer(): Promise<void> {
  if (fridaBusy.value) return
  fridaBusy.value = true
  try {
    await stopFrida()
    toast('已停止 frida-server', 'success')
    await loadStatus()
  } catch (e) {
    toast(errorText(e), 'danger')
  } finally {
    fridaBusy.value = false
  }
}

async function loadStatus(): Promise<void> {
  statusLoading.value = true
  statusError.value = ''
  try {
    const result = await fetchDeviceStatus()
    status.value = result.data
  } catch (e) {
    statusError.value = errorText(e)
  } finally {
    statusLoading.value = false
  }
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer)
    pollTimer = undefined
  }
}

async function pollRun(): Promise<void> {
  if (!runId.value) return
  try {
    const result = await fetchDeviceRun(runId.value)
    runState.value = result.data
    if (result.data.state !== 'running') stopPolling()
  } catch (e) {
    runError.value = errorText(e)
    stopPolling()
  }
}

function startPolling(): void {
  stopPolling()
  pollTimer = window.setInterval(() => {
    void pollRun()
  }, 1200)
}

function currentRun(): DeviceRunState | null {
  return runState.value
}

async function startRun(): Promise<void> {
  if (!hasPoints.value) {
    toast('还没有可注入的轨迹，请先生成', 'warning')
    return
  }
  starting.value = true
  runError.value = ''
  runState.value = null
  try {
    const result = await startDeviceRun(
      preview.value?.points ?? [],
      new Date().toISOString(),
    )
    runId.value = result.data.runId
    toast('设备模拟已启动', 'success')
    await pollRun()
    if (currentRun()?.state === 'running') startPolling()
  } catch (e) {
    runError.value = errorText(e)
    toast(`启动失败：${errorText(e)}`, 'danger')
  } finally {
    starting.value = false
  }
}

async function stopRun(): Promise<void> {
  if (!runId.value) return
  stopping.value = true
  try {
    await stopDeviceRun(runId.value)
    await pollRun()
    stopPolling()
    toast('已发送停止指令', 'info')
  } catch (e) {
    toast(`停止失败：${errorText(e)}`, 'danger')
  } finally {
    stopping.value = false
  }
}

onMounted(() => {
  void loadStatus()
})

onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h2 class="page__title">设备控制台</h2>
        <p class="page__desc">检测 adb / frida 环境，并把模拟轨迹注入到手机端乐跑</p>
      </div>
      <div class="page__actions">
        <UiButton variant="secondary" size="sm" :loading="statusLoading" @click="loadStatus">刷新状态</UiButton>
      </div>
    </div>

    <div class="grid">
      <UiCard title="运行环境" desc="本机回环检测，不经过公网">
        <template #actions>
          <UiStatus
            :tone="status?.frida ? 'success' : 'warning'"
            :label="status?.frida ? 'Frida 就绪' : 'Frida 待启动'"
          />
        </template>

        <div v-if="statusLoading" class="state-block">
          <UiSkeleton :rows="4" :height="14" />
        </div>

        <div v-else-if="statusError" class="state-block">
          <p class="error-text">{{ statusError }}</p>
          <UiButton variant="secondary" size="sm" @click="loadStatus">重试</UiButton>
        </div>

        <div v-else-if="status" class="env">
          <div class="env__row">
            <span class="env__label">ADB 连接</span>
            <span class="env__value">
              {{ status.adb ? status.serial || '已连接' : '未连接' }}
              <span class="env__hint">
                连机与选机在登录页完成（设备列表 + host:5555 手动连接）
                <template v-if="status.devices?.length"> · 当前 {{ status.devices.length }} 台在线</template>
              </span>
            </span>
            <UiStatus :tone="status.adb ? 'success' : 'danger'" :label="status.adb ? '正常' : '异常'" />
          </div>

          <div class="env__row">
            <span class="env__label">本地授权桥</span>
            <span class="env__value">
              {{ status.bridge?.up ? `在线 :${status.bridge.port}` : `未启动 :${status.bridge?.port ?? 8790}` }}
              <span class="env__hint">scripts/login-sync.mjs --serve</span>
            </span>
            <UiStatus :tone="status.bridge?.up ? 'success' : 'neutral'" :label="status.bridge?.up ? '可用' : '未开'" />
          </div>
          <div class="env__row env__row--frida">
            <span class="env__label">Frida</span>
            <span class="env__value">
              {{ status.frida ? '已就绪' : '未就绪' }}
              <span v-if="!status.frida && status.fridaDetail?.reason" class="env__hint">
                {{ status.fridaDetail.reason }}
              </span>
              <span v-else-if="status.fridaDetail?.serverPid" class="env__hint">
                frida-server pid {{ status.fridaDetail.serverPid }}
                <template v-if="status.fridaDetail.appPid"> · App pid {{ status.fridaDetail.appPid }}</template>
              </span>
            </span>
            <span class="env__actions">
              <UiButton
                v-if="!status.frida"
                variant="secondary"
                size="sm"
                :loading="fridaBusy"
                @click="startFridaServer"
              >
                启动 Frida
              </UiButton>
              <UiButton
                v-else
                variant="ghost"
                size="sm"
                :loading="fridaBusy"
                @click="stopFridaServer"
              >
                停止
              </UiButton>
              <UiStatus :tone="status.frida ? 'success' : 'warning'" :label="status.frida ? '正常' : '待启动'" />
            </span>
          </div>
          <div class="env__row">
            <span class="env__label">注入依赖</span>
            <span class="env__value">
              <template v-if="!analysisKnown">服务端未上报</template>
              <template v-else-if="analysisMissing.length">
                缺少 {{ analysisMissing.join(' / ') }}
                <span class="env__hint">需放在仓库根或 exe 同级的 analysis/ 下</span>
              </template>
              <template v-else>runner.py / amap3.js / feed.sh 就位</template>
            </span>
            <UiStatus
              :tone="analysisKnown ? (analysisMissing.length ? 'danger' : 'success') : 'neutral'"
              :label="analysisKnown ? (analysisMissing.length ? '缺失' : '就绪') : '未知'"
            />
          </div>
          <div class="env__row">
            <span class="env__label">前台 Activity</span>
            <span class="env__value u-mono">{{ status.appForeground || '未检测到' }}</span>
            <UiStatus
              :tone="status.appForeground ? 'success' : 'warning'"
              :label="status.appForeground ? '已在前台' : '不在前台'"
            />
          </div>
          <div class="env__row">
            <span class="env__label">跑区时间窗</span>
            <span class="env__value">
              <template v-if="status.runWindow">
                {{ fmtWindowValue(status.runWindow[0]) }} – {{ fmtWindowValue(status.runWindow[1]) }}
              </template>
              <template v-else>服务端未下发</template>
              · 当前 {{ fmtClock(status.now) }}
            </span>
          </div>
        </div>
      </UiCard>

      <UiCard title="注入任务" desc="轮询服务端进度">
        <template #actions>
          <UiStatus :tone="runTone" :label="runLabel" />
        </template>

        <div v-if="runError" class="error-inline">{{ runError }}</div>

        <div class="task-actions">
          <UiButton
            variant="primary"
            :loading="starting"
            :disabled="!hasPoints || running"
            @click="startRun"
          >
            开始设备模拟跑
          </UiButton>
          <UiButton variant="danger" :loading="stopping" :disabled="!running" @click="stopRun">
            停止
          </UiButton>
        </div>

        <div v-if="!hasPoints" class="empty">
          <p class="empty__text">还没有可注入的轨迹</p>
          <UiButton variant="secondary" size="sm" @click="router.push('/simulate')">去生成轨迹</UiButton>
        </div>

        <template v-else>
          <div class="progress">
            <div class="progress__head">
              <span class="progress__label">已注入 {{ fmtInt(injected) }} / {{ fmtInt(total) }} 点</span>
              <span class="progress__pct">{{ percent.toFixed(0) }}%</span>
            </div>
            <div class="progress__bar">
              <span class="progress__fill" :style="{ width: `${percent}%` }"></span>
            </div>
          </div>

          <div class="task-grid">
            <div class="task-item">
              <span class="task-item__label">已跑距离</span>
              <span class="task-item__value">{{ fmtDistance(runState?.distanceKm ?? 0) }}</span>
            </div>
            <div class="task-item">
              <span class="task-item__label">剩余距离</span>
              <span class="task-item__value">{{ fmtDistance(remainingKm) }}</span>
            </div>
            <div class="task-item">
              <span class="task-item__label">经过时间</span>
              <span class="task-item__value">{{ fmtDuration(runState?.elapsedSec ?? 0) }}</span>
            </div>
            <div class="task-item">
              <span class="task-item__label">剩余点数</span>
              <span class="task-item__value">{{ fmtInt(remaining) }}</span>
            </div>
          </div>

          <div class="log">
            <div class="log__head">
              <span class="log__title">链路日志</span>
              <UiTag v-if="runId" tone="neutral">{{ runId }}</UiTag>
            </div>
            <pre v-if="runState?.log.length" class="log__body">{{ runState.log.join('\n') }}</pre>
            <p v-else class="log__empty">等待任务启动…</p>
          </div>
        </template>
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.env {
  display: flex;
  flex-direction: column;
}

.env__row {
  display: grid;
  grid-template-columns: 96px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}

.env__row:last-child {
  border-bottom: none;
}

.env__label {
  font-size: 12px;
  color: var(--c-text-3);
}

.env__value {
  font-size: 13px;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}

.error-text {
  font-size: 13px;
  color: var(--c-danger);
}

.error-inline {
  margin-bottom: 10px;
  padding: 8px 10px;
  border: 1px solid var(--c-danger-border);
  border-radius: var(--r);
  background: var(--c-danger-soft);
  font-size: 12px;
  color: var(--c-danger);
}

.task-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.progress {
  margin-bottom: 14px;
}

.progress__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.progress__label {
  font-size: 12px;
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.progress__pct {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-primary);
  font-variant-numeric: tabular-nums;
}

.progress__bar {
  height: 6px;
  border-radius: 3px;
  background: #eef2f7;
  overflow: hidden;
}

.progress__fill {
  display: block;
  height: 100%;
  background: var(--c-primary);
  transition: width 140ms ease;
}

.task-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.task-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  background: var(--c-surface-2);
}

.task-item__label {
  font-size: 11px;
  color: var(--c-text-3);
}

.task-item__value {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.log {
  border-top: 1px solid var(--c-border);
  padding-top: 12px;
}

.log__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.log__title {
  font-size: 12px;
  font-weight: 600;
}

.log__body {
  margin: 0;
  max-height: 180px;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  background: var(--c-surface-2);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.7;
  color: var(--c-text-2);
  white-space: pre-wrap;
}

.log__empty {
  font-size: 12px;
  color: var(--c-text-3);
}

.empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px dashed var(--c-border);
  border-radius: var(--r);
}

.empty__text {
  font-size: 12px;
  color: var(--c-text-3);
}

.hint-text {
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-2);
}

@media (max-width: 1280px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1024px) {
  .task-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.env__row--frida {
  align-items: flex-start;
}

.env__hint {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--c-text-3);
}

.env__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
</style>
