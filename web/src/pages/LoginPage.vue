<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { connectDevice, errorHint, errorText, fetchDeviceStatus, fetchSession, login, syncSession } from '../api'
import type { AdbDevice, AdbProbe, Profile, SessionMeta } from '../api/types'
import { netState } from '../lib/net'
import {
  DEMO_SCHOOLS,
  DEMO_STUDENT_NUM,
  DEMO_TOKEN,
  DEMO_UID,
  demoProfile,
  demoSchoolByKey,
  demoSession,
  isDemoToken,
} from '../lib/demo'
import { hasFingerprint, missingFingerprint, setSession, store, switchDemoSchool } from '../store'
import { toast } from '../lib/toast'
import UiButton from '../components/ui/UiButton.vue'
import UiField from '../components/ui/UiField.vue'
import UiStatus from '../components/ui/UiStatus.vue'
import UiTag from '../components/ui/UiTag.vue'
import OfflineNote from '../components/OfflineNote.vue'

const router = useRouter()
const route = useRoute()

const form = reactive({
  token: '',
  uid: '',
  school_id: '0',
  student_num: '',
  mobileModel: store.settings.mobileModel,
  mobileDeviceId: store.settings.mobileDeviceId,
  mobileOsVersion: store.settings.mobileOsVersion,
})

type CheckState = 'idle' | 'checking' | 'ok' | 'fail'

const state = ref<CheckState>('idle')
const errMsg = ref('')
const errHint = ref('')
const profile = ref<Profile | null>(null)
const draftSession = ref<SessionMeta | null>(null)
const submitting = ref(false)
const syncing = ref(false)
const showAgreement = ref(false)

let debounceTimer: number | undefined
let seq = 0
let skipValidateOnce = false

const ADB_HOST_KEY = 'lp.adbHost'
const ADB_SERIAL_KEY = 'lp.adbSerial'

const adbHost = ref(localStorage.getItem(ADB_HOST_KEY) || '')
const devices = ref<AdbDevice[]>([])
const selectedSerial = ref(localStorage.getItem(ADB_SERIAL_KEY) || '')
const adbLoading = ref(false)
const connecting = ref(false)
const adbError = ref('')
const adbProbe = ref<AdbProbe | null>(null)

function persistSerial(serial: string): void {
  selectedSerial.value = serial
  try {
    if (serial) localStorage.setItem(ADB_SERIAL_KEY, serial)
    else localStorage.removeItem(ADB_SERIAL_KEY)
  } catch {
  }
}

function syncSelection(list: AdbDevice[]): void {
  if (!list.length) {
    persistSerial('')
    return
  }
  if (list.some((d) => d.serial === selectedSerial.value)) return
  const ready = list.find((d) => d.state === 'device') ?? list[0]
  persistSerial(ready.serial)
}

async function loadDevices(): Promise<void> {
  if (adbLoading.value) return
  adbLoading.value = true
  adbError.value = ''
  try {
    const r = await fetchDeviceStatus()
    devices.value = r.data.devices ?? []
    adbProbe.value = r.data.adbDetail ?? null
    syncSelection(devices.value)
  } catch (e) {
    devices.value = []
    adbError.value = errorText(e)
  } finally {
    adbLoading.value = false
  }
}

async function doConnect(): Promise<void> {
  const host = adbHost.value.trim()
  if (!host || connecting.value) return
  connecting.value = true
  try {
    try {
      localStorage.setItem(ADB_HOST_KEY, host)
    } catch {
    }
    const r = await connectDevice(host)
    if (r.data.ok) {
      if (r.data.serial) persistSerial(r.data.serial)
      toast(`已连接 ${r.data.target}`, 'success')
      await loadDevices()
      const serial = r.data.serial
      if (serial && devices.value.some((d) => d.serial === serial)) persistSerial(serial)
    } else {
      toast(`连接失败：${r.data.text || r.data.target}`, 'danger')
    }
  } catch (e) {
    const hint = errorHint(e)
    if (hint) adbError.value = hint
    toast(`连接失败：${errorText(e)}`, 'danger')
  } finally {
    connecting.value = false
  }
}

const selectedDevice = computed(() => devices.value.find((d) => d.serial === selectedSerial.value) ?? null)

const adbMissing = computed(() => adbProbe.value != null && !adbProbe.value.found)

const adbMissingHint = computed(() => {
  const p = adbProbe.value
  if (!p) return ''
  if (p.isExe) {
    const dir = p.exeDir || '程序所在目录'
    return `把 platform-tools 整个目录复制到 ${dir}\\platform-tools\\（形成 platform-tools\\adb.exe），或设 LP_ADB 指向 adb.exe，然后重启程序。当前用的是 ${p.bin}`
  }
  return `把 platform-tools 整个目录放到仓库根 tools/platform-tools，或设 LP_ADB 指向 adb.exe。当前用的是 ${p.bin}`
})

const fpMissing = computed(() =>
  missingFingerprint({
    mobileModel: form.mobileModel,
    mobileDeviceId: form.mobileDeviceId,
    mobileOsVersion: form.mobileOsVersion,
  }),
)
const fpOk = computed(() => hasFingerprint({
  mobileModel: form.mobileModel,
  mobileDeviceId: form.mobileDeviceId,
  mobileOsVersion: form.mobileOsVersion,
}))

const canCheck = computed(
  () => form.token.trim().length >= 6 && Number(form.uid) > 0 && fpOk.value,
)
const tokenHint = computed(() => (form.token.trim() ? '' : '32 位十六进制字符串'))

function reset(): void {
  state.value = 'idle'
  errMsg.value = ''
  errHint.value = ''
  profile.value = null
  draftSession.value = null
}

async function validate(): Promise<boolean> {
  if (!canCheck.value) {
    reset()
    return false
  }
  const current = ++seq
  state.value = 'checking'
  errMsg.value = ''
  errHint.value = ''
  try {
    const result = await login({
      token: form.token.trim(),
      uid: Number(form.uid),
      school_id: Number(form.school_id) || 0,
      student_num: form.student_num.trim(),
      mobileModel: form.mobileModel.trim(),
      mobileDeviceId: form.mobileDeviceId.trim(),
      mobileOsVersion: form.mobileOsVersion.trim(),
    })
    if (current !== seq) return false
    profile.value = result.data.profile
    draftSession.value = result.data.session
    state.value = 'ok'
    return true
  } catch (e) {
    if (current !== seq) return false
    profile.value = null
    draftSession.value = null
    state.value = 'fail'
    errMsg.value = errorText(e)
    errHint.value = errorHint(e)
    return false
  }
}

function scheduleValidate(): void {
  if (skipValidateOnce) {
    skipValidateOnce = false
    window.clearTimeout(debounceTimer)
    return
  }
  window.clearTimeout(debounceTimer)
  if (!canCheck.value) {
    reset()
    return
  }
  debounceTimer = window.setTimeout(() => {
    void validate()
  }, 700)
}

watch(
  () =>
    [
      form.token,
      form.uid,
      form.school_id,
      form.student_num,
      form.mobileModel,
      form.mobileDeviceId,
      form.mobileOsVersion,
    ].join('|'),
  () => scheduleValidate(),
)

async function hydrateFromServer(): Promise<void> {
  let session: SessionMeta | null = null
  let profileData: Profile | null = null
  try {
    const r = await fetchSession()
    session = r.data.session ?? null
    profileData = r.data.profile ?? null
  } catch {
    return
  }
  if (!session?.token) return
  skipValidateOnce = true
  form.token = session.token
  form.uid = session.uid ? String(session.uid) : ''
  form.school_id = session.school_id !== undefined ? String(session.school_id) : '0'
  form.student_num = session.student_num ?? ''
  form.mobileModel = session.mobileModel ?? ''
  form.mobileDeviceId = session.mobileDeviceId ?? ''
  form.mobileOsVersion = session.mobileOsVersion ?? ''
  profile.value = profileData
  draftSession.value = session
  state.value = 'ok'
  await nextTick()
  skipValidateOnce = false
}

onMounted(() => {
  void loadDevices()
  void hydrateFromServer()
})

onBeforeUnmount(() => window.clearTimeout(debounceTimer))

function commit(session: SessionMeta, profileData: Profile | null): void {
  setSession(session, profileData)
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  router.push(redirect || '/')
}

async function submit(): Promise<void> {
  if (submitting.value) return
  if (isDemoToken(form.token)) {
    const school = demoSchoolByKey(store.demoSchool)
    commit(demoSession(school), demoProfile(school))
    toast(`已进入演示账号：${school.name}`, 'success')
    return
  }
  if (fpMissing.value.length) {
    toast(`请先填写设备指纹：${fpMissing.value.join('、')}（服务端按 token+uid+指纹 定位会话）`, 'danger')
    return
  }
  submitting.value = true
  try {
    let session = draftSession.value
    let profileData = profile.value
    if (!session || state.value !== 'ok') {
      const ok = await validate()
      if (!ok) {
        toast('会话校验未通过，请检查凭据与设备指纹', 'danger')
        return
      }
      session = draftSession.value
      profileData = profile.value
    }
    if (!session) return
    commit(session, profileData)
  } finally {
    submitting.value = false
  }
}

async function doSync(): Promise<void> {
  if (syncing.value) return
  const online = devices.value.filter((d) => d.state === 'device')
  if (!online.length) {
    state.value = 'fail'
    errMsg.value = '没有检测到可用的 adb 设备'
    errHint.value =
      '「从本地桥同步」需要手机在线：USB 连接并打开 USB 调试，或在上面输入 host:5555 点「连接」。没有设备时请手工填写 token / uid / 设备指纹登录'
    toast('没有检测到 adb 设备，本地桥同步不可用', 'danger')
    return
  }
  syncing.value = true
  try {
    const serial = selectedSerial.value || undefined
    const uidNum = Number(form.uid) || undefined
    const quick = await syncSession({ serial, uid: uidNum }).catch(() => null)
    const result =
      quick && !quick.offline && quick.data?.alive !== false ? quick : await syncSession({ live: true, serial, uid: uidNum })
    if (result.offline) {
      state.value = 'fail'
      errMsg.value = '本地桥不可达'
      errHint.value = '后端服务未启动或不可访问；先启动 node server/index.mjs 再点同步'
      toast('本地桥不可达，未载入任何会话', 'danger')
      return
    }
    const session = result.data.session
    form.token = session.token ?? ''
    form.uid = session.uid ? String(session.uid) : ''
    form.school_id = session.school_id !== undefined ? String(session.school_id) : '0'
    form.student_num = session.student_num ?? ''
    form.mobileModel = session.mobileModel ?? ''
    form.mobileDeviceId = session.mobileDeviceId ?? ''
    form.mobileOsVersion = session.mobileOsVersion ?? ''
    profile.value = result.data.profile
    draftSession.value = session

    const alive = result.data.alive
    const st = Number(result.data.status ?? 0)
    if (alive === false) {
      state.value = 'fail'
      errMsg.value = result.data.info || `token 校验未通过（status=${st || '-'}）`
      errHint.value =
        st === 102
          ? '这颗 token 已被手机上的新登录顶掉：把 App 切到前台重新登录一次，再点「从本地桥同步」'
          : st === 101
            ? 'token 对但服务端定位不到这个会话：是设备指纹不对。三项必须与 App 实际发出的完全一致 —— mobileDeviceId 是 App 写在数据目录里的设备 UUID（形如 00000000-xxxx-xxxx-xxxx-xxxxxxxxxxxx），不是 android_id，也不能留空。点「从本地桥同步」会自动取到这三项'
            : st === -4
              ? '设备指纹缺失：mobileModel / mobileOsVersion / mobileDeviceId 三项都必须非空，或点「从本地桥同步」从设备读取'
              : '检查手机是否在线、App 是否已登录（先跑 node scripts/adb-doctor.mjs 看 adb 通不通）'
      toast(`同步到的会话已失效：${errMsg.value}`, 'danger')
      return
    }

    state.value = 'ok'
    toast(
      result.data.refreshed ? '已从本地桥续期并同步会话' : '已从本地桥同步会话',
      'success',
    )
    commit(session, result.data.profile)
  } catch (e) {
    const code = (e as { code?: string }).code
    state.value = 'fail'
    errMsg.value = errorText(e)
    errHint.value =
      code === 'VERSION_TOO_LOW'
        ? '服务端版本门禁未过：设环境变量 LP_VERSION_NAME=4.3.3（可选 LP_VERSION=233）后重启服务，无需重新打包'
        : code === 'NO_DEVICE'
          ? '没有可用的 adb 设备：USB 连接手机并打开 USB 调试，或填 host:5555 点「连接」；不使用设备时请手工填写 token'
          : code === 'NO_SESSION'
            ? '手机没连上或 App 里没有登录态：先 adb connect host:5555，再把 App 切到前台登录一次'
            : code === 'AUTH_KICKED'
              ? 'token 被新登录顶号，在手机上重新登录后重试'
              : errorHint(e)
    toast(`同步失败：${errorText(e)}`, 'danger')
  } finally {
    syncing.value = false
  }
}

function fillDemo(): void {
  form.token = DEMO_TOKEN
  form.uid = String(DEMO_UID)
  form.school_id = String(demoSchool.value.id)
  form.student_num = DEMO_STUDENT_NUM
  form.mobileModel = ''
  form.mobileDeviceId = ''
  form.mobileOsVersion = ''
}

const demoKey = ref(store.demoSchool)
const demoSchool = computed(() => demoSchoolByKey(demoKey.value))

function pickDemoSchool(key: string): void {
  demoKey.value = switchDemoSchool(key)
}

function enterDemo(): void {
  const school = demoSchool.value
  commit(demoSession(school), demoProfile(school))
  toast(`已进入演示账号：${school.name}`, 'success')
}

const demoOpen = ref(false)

const statusTone = computed(() => {
  if (state.value === 'ok') return 'success' as const
  if (state.value === 'fail') return 'danger' as const
  if (state.value === 'checking') return 'primary' as const
  return 'neutral' as const
})

const statusLabel = computed(() => {
  if (state.value === 'ok') return '会话有效'
  if (state.value === 'fail') return '校验未通过'
  if (state.value === 'checking') return '校验中'
  return '等待输入'
})
</script>

<template>
  <div class="login">
    <div class="login__inner">
      <div class="login__brand">
        <span class="login__mark" aria-hidden="true">乐</span>
        <div class="login__brand-text">
          <strong>乐跑控制台</strong>
          <span>第三方运动数据客户端</span>
        </div>
      </div>

      <section class="login__card">
        <header class="login__head">
          <h1 class="login__title">登录控制台</h1>
          <UiStatus :tone="statusTone" :label="statusLabel" />
        </header>
        <p class="login__desc">使用乐跑会话凭据登录，凭据仅保存在本机浏览器。</p>

        <div class="login__demo-entry">
          <button type="button" class="login__demo-key" @click="enterDemo">
            <span class="login__demo-key-dot" aria-hidden="true"></span>
            <span class="login__demo-key-text">演示账号</span>
            <span class="login__demo-key-tag">免登录</span>
          </button>

          <div class="login__demo-schools">
            <span class="login__demo-label">演示学校</span>
            <div class="login__demo-chips">
              <button
                v-for="s in DEMO_SCHOOLS"
                :key="s.key"
                type="button"
                class="login__demo-chip"
                :class="{ 'is-active': s.key === demoKey }"
                :title="`${s.name} · ${s.checkpoints.length} 个打卡点`"
                @click="pickDemoSchool(s.key)"
              >
                {{ s.name }}
              </button>
            </div>
          </div>

          <button type="button" class="login__demo-more" @click="demoOpen = !demoOpen">
            {{ demoOpen ? '收起账号信息' : '账号信息' }}
          </button>
        </div>

        <div v-show="demoOpen" class="login__demo-info">
          <div class="login__demo-creds">
            <div class="login__demo-cred">
              <span class="login__demo-cred-key">Token</span>
              <span class="login__demo-cred-val u-mono">{{ DEMO_TOKEN }}</span>
            </div>
            <div class="login__demo-cred">
              <span class="login__demo-cred-key">UID</span>
              <span class="login__demo-cred-val u-mono">{{ DEMO_UID }}</span>
            </div>
            <div class="login__demo-cred">
              <span class="login__demo-cred-key">学号</span>
              <span class="login__demo-cred-val u-mono">{{ DEMO_STUDENT_NUM }}</span>
            </div>
            <div class="login__demo-cred">
              <span class="login__demo-cred-key">学校 ID</span>
              <span class="login__demo-cred-val u-mono">{{ demoSchool.id }}</span>
            </div>
          </div>

          <p class="login__demo-note">
            演示账号内置 {{ DEMO_SCHOOLS.length }} 所学校的跑区与打卡点。进入控制台后还能在页面顶部切换学校，
            地图会重新定位到该校并显示它自己的打卡点。
          </p>

          <div class="login__demo-actions">
            <UiButton variant="ghost" size="sm" @click="fillDemo">填入表单</UiButton>
          </div>
        </div>

        <form class="login__form" @submit.prevent="submit">
          <UiField label="Token" required :hint="tokenHint">
            <input
              v-model="form.token"
              class="inp inp--mono"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="粘贴 token"
            />
          </UiField>

          <div class="login__grid">
            <UiField label="UID" required>
              <input v-model="form.uid" class="inp" type="text" inputmode="numeric" placeholder="如 10000001" />
            </UiField>
            <UiField label="学校 ID" hint="未知可填 0">
              <input v-model="form.school_id" class="inp" type="text" inputmode="numeric" placeholder="0" />
            </UiField>
          </div>

          <UiField label="学号" hint="可留空">
            <input v-model="form.student_num" class="inp" type="text" autocomplete="off" placeholder="学号" />
          </UiField>

          <fieldset class="login__adb">
            <legend class="login__adb-legend">
              ADB 设备
              <span class="login__adb-note">
                USB 直连的手机自动出现在列表里；网络 adb 在下面手动输入 host:5555 再点「连接」。同步会话时使用选中的那台。
              </span>
            </legend>

            <div class="login__adb-connect">
              <input
                v-model="adbHost"
                class="inp inp--mono"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="如 手机IP:5555"
                @keydown.enter.prevent="doConnect"
              />
              <UiButton variant="secondary" size="sm" :loading="connecting" @click="doConnect">连接</UiButton>
              <UiButton variant="ghost" size="sm" :loading="adbLoading" @click="loadDevices">刷新</UiButton>
            </div>

            <p v-if="adbMissing" class="login__adb-hint">未检测到 adb —— {{ adbMissingHint }}</p>

            <p v-if="adbError" class="login__adb-error">{{ adbError }}</p>

            <p v-else-if="adbLoading && !devices.length" class="login__adb-empty">正在检查 adb 设备…</p>

            <p v-else-if="!devices.length" class="login__adb-empty">
              没有检测到设备：插上 USB 并打开 USB 调试，或用上面的输入框 adb connect 之后点「刷新」。
            </p>

            <div v-else class="login__adb-list">
              <label
                v-for="d in devices"
                :key="d.serial"
                class="login__adb-item"
                :class="{ 'is-active': d.serial === selectedSerial }"
              >
                <input
                  class="login__adb-radio"
                  type="radio"
                  name="lp-adb-device"
                  :value="d.serial"
                  :checked="d.serial === selectedSerial"
                  @change="persistSerial(d.serial)"
                />
                <span class="login__adb-serial u-mono">{{ d.serial }}</span>
                <span class="login__adb-meta">{{ d.model || d.product || '-' }}</span>
                <UiTag :tone="d.state === 'device' ? 'success' : 'warning'">{{ d.state }}</UiTag>
              </label>
            </div>

            <p v-if="selectedDevice" class="login__adb-selected">
              已选 <span class="u-mono">{{ selectedDevice.serial }}</span>
              <span class="login__adb-selected-meta">
                {{ selectedDevice.model || selectedDevice.product || '-' }} · {{ selectedDevice.state }}
                <template v-if="selectedDevice.tcp"> · 网络 adb</template>
              </span>
            </p>
          </fieldset>

          <fieldset class="login__fp">
            <legend class="login__fp-legend">
              设备指纹
              <span class="login__fp-note">服务端按 token + uid + 这三项定位会话，填错会返回「登录信息失效」</span>
            </legend>

            <div class="login__grid">
              <UiField label="mobileModel" required hint="设备型号，与登录那台手机一致">
                <input
                  v-model="form.mobileModel"
                  class="inp inp--mono"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="如 SM-G9980"
                />
              </UiField>
              <UiField label="mobileOsVersion" required hint="系统版本，如 14 / 15 / 17">
                <input
                  v-model="form.mobileOsVersion"
                  class="inp"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="如 14"
                />
              </UiField>
            </div>

            <UiField label="mobileDeviceId" required hint="App 实际发出的设备 UUID（形如 00000000-xxxx-xxxx-xxxx-xxxxxxxxxxxx）；留空会得到「0 系统错误」">
              <input
                v-model="form.mobileDeviceId"
                class="inp inp--mono"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </UiField>

            <p v-if="fpMissing.length" class="login__fp-warn">
              尚未填写：{{ fpMissing.join('、') }}。缺项时不会自动套用任何默认值，请补全或用「从本地桥同步」从真机采集。
            </p>
          </fieldset>

          <p v-if="state === 'fail'" class="login__error">
            {{ errMsg }}
            <span v-if="errHint" class="login__error-hint">{{ errHint }}</span>
          </p>
        </form>

        <div v-if="profile" class="login__preview">
          <div class="login__preview-head">
            <span class="login__preview-name">{{ profile.nick_name || '未命名账号' }}</span>
            <UiTag tone="primary">已连接</UiTag>
          </div>
          <div class="login__preview-grid">
            <div>
              <span class="login__preview-label">学校</span>
              <span class="login__preview-value">{{ profile.school_name || '--' }}</span>
            </div>
            <div>
              <span class="login__preview-label">有效次数</span>
              <span class="login__preview-value">{{ profile.total_valid_num }}</span>
            </div>
            <div>
              <span class="login__preview-label">有效公里</span>
              <span class="login__preview-value">{{ Number(profile.total_valid_distance).toFixed(2) }} km</span>
            </div>
          </div>
        </div>

        <div class="login__actions">
          <UiButton variant="primary" block :loading="submitting" @click="submit">进入控制台</UiButton>
          <UiButton variant="secondary" block :loading="syncing" @click="doSync">从本地桥同步</UiButton>
        </div>

        <div class="login__hintrow">
          <span v-if="netState.demo" class="login__demo-live">演示数据已启用，请求不会发出本机</span>
          <template v-else>
            <OfflineNote v-if="netState.offline" />
          </template>
        </div>

        <div class="login__agreement">
          <button class="login__link" type="button" @click="showAgreement = !showAgreement">
            {{ showAgreement ? '收起协议说明' : '协议说明' }}
          </button>
          <div v-show="showAgreement" class="login__agreement-body">
            <p>1. 本控制台只读取并展示当前账号的乐跑数据，用于个人运动记录查看与轨迹分析。</p>
            <p>2. 会话凭据存储在本机浏览器的 localStorage，仅发送到已配置的 API Host。</p>
            <p>3. 轨迹与诊断结果在本地生成，不上传到任何第三方服务，也不参与排名或社交互动。</p>
            <p>4. 退出登录或清除会话会立即删除本机凭据；请勿在公共设备上保存会话。</p>
            <p>5. 使用本工具产生的一切后果由使用者自行承担。</p>
          </div>
        </div>
      </section>

      <p class="login__foot">会话状态由服务端校验，失效后需重新同步。</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  background: var(--c-bg);
}

.login__inner {
  width: 480px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.login__brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.login__mark {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  background: var(--c-primary);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.login__brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.login__brand-text strong {
  font-size: 13px;
  font-weight: 600;
}

.login__brand-text span {
  font-size: 11px;
  color: var(--c-text-3);
}

.login__card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  padding: 22px;
  transition: box-shadow var(--t);
}

.login__card:hover {
  box-shadow: var(--shadow-hover);
}

.login__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.login__title {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.login__desc {
  margin-top: 6px;
  font-size: 12px;
  color: var(--c-text-3);
}

.login__form {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.login__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.login__error {
  font-size: 12px;
  color: var(--c-danger);
  line-height: 1.5;
}

.login__fp {
  margin: 2px 0 0;
  padding: 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  background: var(--c-surface-2);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.login__adb {
  margin: 2px 0 0;
  padding: 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  background: var(--c-surface-2);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.login__adb-legend {
  padding: 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-2);
}

.login__adb-note {
  display: block;
  margin-top: 2px;
  font-weight: 400;
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-3);
}

.login__adb-connect {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.login__adb-connect .inp {
  flex: 1;
  min-width: 0;
}

.login__adb-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login__adb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  background: var(--c-surface);
  font-size: 12px;
  cursor: pointer;
  transition: border-color var(--t), background var(--t);
}

.login__adb-item:hover {
  border-color: var(--c-border-strong);
}

.login__adb-item.is-active {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
}

.login__adb-radio {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--c-primary);
}

.login__adb-serial {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text);
}

.login__adb-meta {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--c-text-3);
}

.login__adb-empty,
.login__adb-error,
.login__adb-hint {
  font-size: 11px;
  line-height: 1.6;
}

.login__adb-empty {
  color: var(--c-text-3);
}

.login__adb-error {
  color: var(--c-danger);
}

.login__adb-hint {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(214, 158, 46, 0.12);
  color: var(--c-warn, #b7791f);
  word-break: break-all;
}

.login__adb-selected {
  font-size: 11px;
  color: var(--c-text-2);
}

.login__adb-selected-meta {
  margin-left: 6px;
  color: var(--c-text-3);
}

.login__fp-legend {
  padding: 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-2);
}

.login__fp-note {
  display: block;
  font-weight: 400;
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-3);
}

.login__fp-warn {
  font-size: 11px;
  line-height: 1.6;
  color: var(--c-warning, #b45309);
}

.login__error-hint {
  display: block;
  color: var(--c-text-3);
}

.login__demo-entry {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--c-primary-border);
  border-radius: var(--r);
  background: var(--c-primary-soft);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.login__demo-key {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--c-primary);
  color: #ffffff;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: filter var(--t);
}

.login__demo-key:hover {
  filter: brightness(1.08);
}

.login__demo-key:active {
  transform: translateY(1px);
}

.login__demo-key-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffffff;
  opacity: 0.9;
}

.login__demo-key-text {
  flex: 1 1 auto;
  text-align: left;
}

.login__demo-key-tag {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
}

.login__demo-schools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.login__demo-label {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--c-text-3);
}

.login__demo-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.login__demo-more {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--c-text-3);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline dotted;
}

.login__demo-more:hover {
  color: var(--c-primary);
}

.login__demo-info {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.login__demo-chip {
  padding: 4px 9px;
  border: 1px solid var(--c-border);
  border-radius: 999px;
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: border-color var(--t), color var(--t), box-shadow var(--t);
}

.login__demo-chip:hover {
  border-color: var(--c-primary-border);
  color: var(--c-text);
}

.login__demo-chip.is-active {
  border-color: var(--c-primary);
  color: var(--c-primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--c-primary);
}

.login__demo-creds {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
}

.login__demo-cred {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.login__demo-cred-key {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--c-text-3);
}

.login__demo-cred-val {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--c-text-2);
}

.login__demo-note {
  font-size: 11px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.login__demo-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.login__demo-actions :deep(.btn--block),
.login__demo-actions :deep(.btn) {
  flex: 1;
}

.login__demo-live {
  font-size: 11px;
  color: var(--c-primary);
}

.login__preview {
  margin-top: 14px;
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  background: var(--c-surface-2);
  padding: 12px;
}

.login__preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--c-border);
}

.login__preview-name {
  font-size: 13px;
  font-weight: 600;
}

.login__preview-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding-top: 10px;
}

.login__preview-label {
  display: block;
  font-size: 11px;
  color: var(--c-text-3);
}

.login__preview-value {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.login__actions {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.login__hintrow {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 16px;
}

.login__link {
  font-size: 12px;
  color: var(--c-primary);
  text-decoration: none;
}

.login__link:hover {
  text-decoration: underline;
}

.login__agreement {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--c-border);
}

.login__agreement-body {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.login__foot {
  text-align: center;
  font-size: 11px;
  color: var(--c-text-3);
}

@media (max-width: 520px) {
  .login__preview-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
