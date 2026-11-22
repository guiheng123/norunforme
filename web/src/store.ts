import { reactive } from 'vue'
import { setApiBase } from './lib/net'
import { currentDemoSchoolKey, isDemoToken, setDemoSchoolKey } from './lib/demo'
import type {
  DiagnosticItem,
  Profile,
  SessionMeta,
  TrackCheckpoint,
  TrackPointDTO,
  TrackStats,
  Verdict,
} from './api/types'

export interface AppSettings {
  mobileModel: string
  mobileDeviceId: string
  mobileOsVersion: string
  apiHost: string
  theme: 'light'
}

export interface PreviewCache {
  points: TrackPointDTO[]
  checkpoints: TrackCheckpoint[]
  stats: TrackStats
  diagnostics: DiagnosticItem[]
  verdict: Verdict
  createdAt: number
  params: {
    targetKm: number
    paceSec: number
    seed: number | null
    startAt: string
    startMode?: 'now' | 'at'
    radius: number
    noisePct: number
  }
}

const KEY = {
  session: 'lepao.web.session',
  profile: 'lepao.web.profile',
  settings: 'lepao.web.settings',
  preview: 'lepao.web.preview',
}

export const DEFAULT_SETTINGS: AppSettings = {
  mobileModel: '',
  mobileDeviceId: '',
  mobileOsVersion: '',
  apiHost: '',
  theme: 'light',
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
  }
}

function normalizeSettings(input: Partial<AppSettings> | null): AppSettings {
  return { ...DEFAULT_SETTINGS, ...(input ?? {}), theme: 'light' }
}

export const store = reactive({
  session: read<SessionMeta | null>(KEY.session, null),
  profile: read<Profile | null>(KEY.profile, null),
  settings: normalizeSettings(read<Partial<AppSettings> | null>(KEY.settings, null)),
  preview: read<PreviewCache | null>(KEY.preview, null),
  demoSchool: currentDemoSchoolKey(),
})

setApiBase(store.settings.apiHost)

export function hasSession(): boolean {
  return Boolean(store.session && String(store.session.token ?? '').trim())
}

export function hasFingerprint(input?: Partial<AppSettings> | null): boolean {
  const s = input ?? store.settings
  return Boolean(
    String(s.mobileModel ?? '').trim() &&
      String(s.mobileOsVersion ?? '').trim() &&
      String(s.mobileDeviceId ?? '').trim(),
  )
}

export function missingFingerprint(input?: Partial<AppSettings> | null): string[] {
  const s = input ?? store.settings
  const miss: string[] = []
  if (!String(s.mobileModel ?? '').trim()) miss.push('mobileModel')
  if (!String(s.mobileOsVersion ?? '').trim()) miss.push('mobileOsVersion')
  if (!String(s.mobileDeviceId ?? '').trim()) miss.push('mobileDeviceId')
  return miss
}

export function setSession(session: SessionMeta, profile: Profile | null): void {
  store.session = session
  store.profile = profile
  if (isDemoToken(session.token) && session.school_id) {
    store.demoSchool = setDemoSchoolKey(String(session.zone_id ?? session.school_id))
  }
  write(KEY.session, session)
  write(KEY.profile, profile)
}

export function setProfile(profile: Profile | null): void {
  store.profile = profile
  write(KEY.profile, profile)
}

export function clearSession(): void {
  store.session = null
  store.profile = null
  write(KEY.session, null)
  write(KEY.profile, null)
}

const APP_KEY_PREFIXES = ['lepao.', 'lp.']

function purgeAppStorage(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && APP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
    for (const key of Object.values(KEY)) localStorage.removeItem(key)
  } catch {
  }
}

export function clearAll(): void {
  store.session = null
  store.profile = null
  store.preview = null
  store.settings = { ...DEFAULT_SETTINGS }
  setApiBase('')
  purgeAppStorage()
}

export function saveSettings(patch: Partial<AppSettings>): void {
  store.settings = normalizeSettings({ ...store.settings, ...patch })
  write(KEY.settings, store.settings)
  setApiBase(store.settings.apiHost)
}

export function setPreviewCache(value: PreviewCache | null): void {
  store.preview = value
  write(KEY.preview, value)
}

export function sessionLabel(): string {
  const profile = store.profile
  if (profile?.nick_name) return profile.nick_name
  if (store.session?.uid) return `UID ${store.session.uid}`
  return '未登录'
}

export function schoolLabel(): string {
  return store.profile?.school_name ?? ''
}

export function isDemoMode(): boolean {
  return isDemoToken(store.session?.token)
}

export function switchDemoSchool(key: string): string {
  const next = setDemoSchoolKey(key)
  store.demoSchool = next
  return next
}
