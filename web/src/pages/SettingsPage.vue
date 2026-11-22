<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { clearAll, hasFingerprint, missingFingerprint, saveSettings, setSession, store } from '../store'
import { deleteSession, errorText, syncSession } from '../api'
import { ellipsis } from '../lib/format'
import { noticeMuted as noticeIsMuted, unmuteNotice } from '../lib/notice-state'
import { toast } from '../lib/toast'
import NoticeModal from '../components/NoticeModal.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiField from '../components/ui/UiField.vue'
import UiModal from '../components/ui/UiModal.vue'
import UiStatus from '../components/ui/UiStatus.vue'
import UiTag from '../components/ui/UiTag.vue'

const router = useRouter()

const form = reactive({
  mobileModel: store.settings.mobileModel,
  mobileDeviceId: store.settings.mobileDeviceId,
  mobileOsVersion: store.settings.mobileOsVersion,
  apiHost: store.settings.apiHost,
})

const confirmOpen = ref(false)
const syncing = ref(false)
const clearing = ref(false)
const noticeOpen = ref(false)
const noticeOff = ref(noticeIsMuted())

function openNotice(): void {
  if (noticeOff.value) {
    unmuteNotice()
    noticeOff.value = false
    toast('已恢复启动时显示使用须知', 'success')
    return
  }
  noticeOpen.value = true
}

function onNoticeMuted(): void {
  noticeOff.value = true
  toast('已关闭启动时的使用须知提示；可在本卡片点「恢复启动提醒」重新开启', 'success')
}

const session = computed(() => store.session)
const profile = computed(() => store.profile)
const tokenPreview = computed(() => (session.value?.token ? ellipsis(session.value.token, 8, 6) : '--'))

const fingerprintMissingList = computed(() => missingFingerprint(form))
const fingerprintOk = computed(() => hasFingerprint(form))

const dirty = computed(
  () =>
    form.mobileModel !== store.settings.mobileModel ||
    form.mobileDeviceId !== store.settings.mobileDeviceId ||
    form.mobileOsVersion !== store.settings.mobileOsVersion ||
    form.apiHost !== store.settings.apiHost,
)

function save(): void {
  const miss = missingFingerprint(form)
  if (miss.length) {
    toast(`设备指纹未填全：${miss.join('、')}。服务端按 token + uid + 指纹定位会话，缺项会一律返回「登录信息失效」`, 'danger')
    return
  }
  saveSettings({
    mobileModel: form.mobileModel.trim(),
    mobileDeviceId: form.mobileDeviceId.trim(),
    mobileOsVersion: form.mobileOsVersion.trim(),
    apiHost: form.apiHost.trim(),
  })
  toast('设置已保存', 'success')
}

async function pullFromDevice(): Promise<void> {
  if (syncing.value) return
  syncing.value = true
  try {
    const result = await syncSession({ live: true })
    const s = result.data.session
    if (s.mobileModel !== undefined) form.mobileModel = s.mobileModel ?? ''
    if (s.mobileDeviceId !== undefined) form.mobileDeviceId = s.mobileDeviceId ?? ''
    if (s.mobileOsVersion !== undefined) form.mobileOsVersion = s.mobileOsVersion ?? ''
    setSession(s, result.data.profile ?? store.profile)
    const miss = missingFingerprint(form)
    if (miss.length) {
      toast(`设备侧只读到部分指纹，仍缺：${miss.join('、')}`, 'warning')
    } else {
      toast('已从设备读取指纹，请核对后保存', 'success')
    }
  } catch (e) {
    toast(`读取设备指纹失败：${e instanceof Error ? e.message : String(e)}`, 'danger')
  } finally {
    syncing.value = false
  }
}

function resetFingerprint(): void {
  form.mobileModel = ''
  form.mobileDeviceId = ''
  form.mobileOsVersion = ''
  toast('已清空指纹输入；请重新填写或从设备读取，否则请求会被拒绝', 'info')
}

async function doClear(): Promise<void> {
  if (clearing.value) return
  clearing.value = true
  let serverError = ''
  let leftover = false
  try {
    const result = await deleteSession()
    leftover = result.data.fileRemoved === false && result.data.fileEmptied === false
  } catch (e) {
    serverError = errorText(e)
  }
  confirmOpen.value = false
  clearAll()
  router.push('/login')
  if (serverError) {
    toast(`本机数据已清除；服务端会话未清除（${serverError}）。服务恢复后请再清一次`, 'danger')
  } else if (leftover) {
    toast('本机数据已清除；服务端会话文件被占用或无权限删除，请关闭占用进程后再清一次', 'warning')
  } else {
    toast('本机会话、设备指纹、缓存与服务端会话已全部清除', 'success')
  }
  clearing.value = false
}
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h2 class="page__title">设置</h2>
        <p class="page__desc">设备指纹、接口地址与会话管理</p>
      </div>
      <div class="page__actions">
        <UiButton variant="secondary" size="sm" :disabled="!dirty" @click="save">保存设置</UiButton>
      </div>
    </div>

    <div class="grid">
      <UiCard title="设备指纹" desc="服务端按 token + uid + 这三项定位会话，填错会返回「登录信息失效」">
        <div class="form">
          <UiField label="mobileModel" required hint="设备型号，务必与登录时那台手机一致（抓包/App「关于」里可见）">
            <input v-model="form.mobileModel" class="inp" type="text" spellcheck="false" placeholder="如 SM-G9980" />
          </UiField>
          <UiField label="mobileDeviceId" required hint="App 实际发出的设备 UUID（形如 00000000-xxxx-xxxx-xxxx-xxxxxxxxxxxx）；留空会得到「0 系统错误」">
            <input v-model="form.mobileDeviceId" class="inp inp--mono" type="text" spellcheck="false" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          </UiField>
          <UiField label="mobileOsVersion" required hint="系统版本号，例如 14 / 15 / 17">
            <input v-model="form.mobileOsVersion" class="inp" type="text" spellcheck="false" placeholder="如 14" />
          </UiField>
        </div>
        <p v-if="fingerprintMissingList.length" class="note note--warn">
          尚未填写：{{ fingerprintMissingList.join('、') }}。缺项时后端会直接拒绝发请求（NO_FINGERPRINT），
          不会再用任何内置默认值替你发出去。
        </p>
        <template #footer>
          <UiButton variant="ghost" size="sm" :loading="syncing" @click="pullFromDevice">从设备读取</UiButton>
          <UiButton variant="ghost" size="sm" @click="resetFingerprint">清空输入</UiButton>
          <UiButton variant="primary" size="sm" :disabled="!dirty || !fingerprintOk" @click="save">保存</UiButton>
        </template>
      </UiCard>

      <div class="side">
        <UiCard title="接口地址" desc="留空则使用同源 /api">
          <UiField
            label="API Host"
            hint="例如 http://127.0.0.1:8787；修改后立即对后续请求生效"
          >
            <input v-model="form.apiHost" class="inp inp--mono" type="text" placeholder="留空使用同源" spellcheck="false" />
          </UiField>
          <p class="note">
            当前请求基地址：<span class="u-mono">{{ store.settings.apiHost || '同源 /api' }}</span>
          </p>
        </UiCard>

        <UiCard title="外观">
          <div class="theme">
            <label class="theme__option is-active">
              <input type="radio" name="theme" value="light" checked disabled />
              <span>
                <strong>浅色</strong>
                <em>当前唯一可用主题</em>
              </span>
            </label>
          </div>
        </UiCard>

        <UiCard title="使用须知" desc="免责声明、项目来源与禁止事项">
          <p class="note">
            {{
              noticeOff
                ? '启动时的使用须知提示已关闭。点下方按键立即恢复，下次启动会重新显示。'
                : '启动时会自动显示使用须知。点下方按键阅读全文，读满 10 秒后可关闭启动时的自动提示。'
            }}
          </p>
          <template #footer>
            <UiButton variant="ghost" size="sm" @click="openNotice">
              {{ noticeOff ? '恢复启动提醒' : '使用须知不再提醒' }}
            </UiButton>
          </template>
        </UiCard>

        <UiCard title="会话">
          <div class="kv">
            <span class="kv__k">昵称</span>
            <span class="kv__v">{{ profile?.nick_name || '--' }}</span>

            <span class="kv__k">学校</span>
            <span class="kv__v">{{ profile?.school_name || '--' }}</span>

            <span class="kv__k">UID</span>
            <span class="kv__v">{{ session?.uid ?? '--' }}</span>

            <span class="kv__k">学校 ID</span>
            <span class="kv__v">{{ session?.school_id ?? '--' }}</span>

            <span class="kv__k">Token</span>
            <span class="kv__v u-mono">{{ tokenPreview }}</span>
          </div>

          <div class="session-state">
            <UiStatus
              :tone="session ? 'success' : 'neutral'"
              :label="session ? '已登录' : '未登录'"
            />
            <UiTag v-if="store.preview" tone="neutral">本地缓存轨迹</UiTag>
          </div>

          <template #footer>
            <UiButton variant="danger" size="sm" :loading="clearing" @click="confirmOpen = true">清除会话</UiButton>
          </template>
        </UiCard>
      </div>
    </div>

    <NoticeModal mode="manual" :open="noticeOpen" @close="noticeOpen = false" @action="onNoticeMuted" />

    <UiModal :open="confirmOpen" title="清除本机会话" :width="460" @close="confirmOpen = false">
      <p class="confirm-text">
        将删除服务端保存的会话凭据（含设备侧运行残留），以及本机的会话、资料、设备指纹、接口地址、预览轨迹缓存与 adb 设备选择。
        清除后「从本地桥同步」需要重新连接手机，无法凭旧缓存进入。此操作不可撤销。
      </p>
      <template #footer>
        <UiButton variant="secondary" :disabled="clearing" @click="confirmOpen = false">取消</UiButton>
        <UiButton variant="danger" :loading="clearing" @click="doClear">确认清除</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
  align-items: start;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.note {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--c-border);
  font-size: 11px;
  color: var(--c-text-3);
  word-break: break-all;
}

.note--warn {
  color: var(--c-warning, #b45309);
}

.theme__option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  background: var(--c-surface);
}

.theme__option.is-active {
  border-color: var(--c-primary-border);
  background: var(--c-primary-soft);
}

.theme__option input {
  margin-top: 2px;
}

.theme__option span {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.theme__option strong {
  font-size: 13px;
  font-weight: 500;
}

.theme__option em {
  font-style: normal;
  font-size: 11px;
  color: var(--c-text-3);
}

.session-state {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--c-border);
  display: flex;
  align-items: center;
  gap: 8px;
}

.confirm-text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--c-text-2);
}

@media (max-width: 1280px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
