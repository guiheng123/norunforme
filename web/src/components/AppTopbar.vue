<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { deleteSession, errorText, fetchSession, fetchSessionHealth } from '../api'
import { clearSession, hasSession, missingFingerprint, sessionLabel, schoolLabel, setProfile, setSession, store } from '../store'
import { toast } from '../lib/toast'
import UiStatus from './ui/UiStatus.vue'
import UiButton from './ui/UiButton.vue'

const route = useRoute()
const router = useRouter()

const title = computed(() => String(route.meta.title ?? '控制台'))
const crumb = computed(() => (route.name === 'record-detail' ? '跑步记录 / 详情' : '控制台'))

const alive = ref<boolean | null>(null)
const gateHint = ref('')
const refreshing = ref(false)

const fpMissing = computed(() =>
  missingFingerprint({
    mobileModel: (store.session?.mobileModel as string) ?? store.settings.mobileModel,
    mobileDeviceId: (store.session?.mobileDeviceId as string) ?? store.settings.mobileDeviceId,
    mobileOsVersion: (store.session?.mobileOsVersion as string) ?? store.settings.mobileOsVersion,
  }),
)

const sessionText = computed(() => {
  if (!hasSession()) return '未登录'
  const school = schoolLabel()
  return school ? `${sessionLabel()} · ${school}` : sessionLabel()
})

const sessionTone = computed(() => {
  if (!hasSession()) return 'neutral' as const
  if (alive.value === false) return 'warning' as const
  if (alive.value === true) return 'success' as const
  return 'primary' as const
})

const sessionHint = computed(() => {
  if (!hasSession()) return '尚未建立会话'
  if (gateHint.value) return gateHint.value
  if (fpMissing.value.length) return `缺少设备指纹：${fpMissing.value.join('、')}（服务端按 token+uid+指纹 定位会话）`
  if (alive.value === true) return '会话有效'
  if (alive.value === false) return '会话已失效：token / uid / 设备指纹三者之一不匹配，请到登录页核对'
  return '会话状态待确认'
})

async function checkHealth(): Promise<void> {
  if (!hasSession()) {
    alive.value = null
    gateHint.value = ''
    return
  }
  try {
    const result = await fetchSessionHealth()
    alive.value = Boolean(result.data.alive)
    gateHint.value =
      result.data.gate === 'version'
        ? `服务端要求升级（当前 version_name=${result.data.version_name ?? '?'}）：设 LP_VERSION_NAME=4.3.3 后重启服务`
        : result.data.needFingerprint
          ? `缺少设备指纹：${(result.data.missing ?? []).join('、')}`
          : ''
  } catch {
    alive.value = false
    gateHint.value = ''
  }
}

async function refresh(): Promise<void> {
  if (!hasSession()) {
    router.push('/login')
    return
  }
  refreshing.value = true
  try {
    const result = await fetchSession()
    setSession(result.data.session, result.data.profile)
    alive.value = true
    toast('会话与资料已刷新', 'success')
  } catch {
    await checkHealth()
    toast('刷新失败，请检查会话是否仍然有效', 'warning')
  } finally {
    refreshing.value = false
  }
}

async function logout(): Promise<void> {
  let serverError = ''
  try {
    await deleteSession()
  } catch (e) {
    serverError = errorText(e)
  }
  clearSession()
  alive.value = null
  router.push('/login')
  toast(
    serverError
      ? `本机已退出；服务端会话未清除（${serverError}），请在设置页再清一次`
      : '已退出当前会话',
    serverError ? 'warning' : 'info',
  )
}

onMounted(() => {
  void checkHealth()
  if (!store.profile && hasSession()) {
    fetchSession()
      .then((result) => setProfile(result.data.profile))
      .catch(() => undefined)
  }
})
</script>

<template>
  <header class="topbar">
    <div class="topbar__lead">
      <div class="topbar__crumb">{{ crumb }}</div>
      <h1 class="topbar__title">{{ title }}</h1>
    </div>

    <div class="topbar__right">
      <span :title="sessionHint">
        <UiStatus :tone="sessionTone" :label="sessionText" />
      </span>
      <UiButton variant="ghost" size="sm" :loading="refreshing" @click="refresh">刷新会话</UiButton>
      <UiButton v-if="hasSession()" variant="ghost" size="sm" @click="logout">退出</UiButton>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: var(--topbar-h);
  padding: 0 24px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
}

.topbar__lead {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.topbar__crumb {
  font-size: 11px;
  line-height: 1.2;
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar__title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--c-text);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

@media (max-width: 1024px) {
  .topbar {
    padding: 0 16px;
  }

  .topbar__right :deep(.btn:first-of-type) {
    display: none;
  }
}
</style>
