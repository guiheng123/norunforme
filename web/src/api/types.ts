export interface ApiFailBody {
  code: string
  message: string
  hint?: string
}

export interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: ApiFailBody
}

export interface SessionMeta {
  token: string
  uid: number
  school_id: number
  student_num: string
  mobileModel?: string
  mobileDeviceId?: string
  mobileOsVersion?: string
  api_host?: string
  [k: string]: unknown
}

export interface Profile {
  nick_name: string
  school_name: string
  avatar: string
  total_valid_num: number
  total_valid_distance: number
  week_num: number
  week_distance: number
}

export interface SessionPayload {
  session: SessionMeta
  profile: Profile
  alive?: boolean
  status?: number
  info?: string
  verified?: boolean
  refreshed?: boolean
  trace?: string[]
  needFingerprint?: boolean
  missing?: string[]
}

export interface SessionHealth {
  alive: boolean
  status: number
  info: string
  gate?: string
  version_name?: string
  hint?: string
  fingerprint?: {
    mobileModel?: string
    mobileDeviceId?: string
    mobileOsVersion?: string
  }
  needFingerprint?: boolean
  missing?: string[]
}

export interface Term {
  term_id: string
  term_name: string
  status: string
}

export interface RunRecord {
  id: string
  start_time: string
  end_time: string
  distance: number
  used_time: number
  record_status: number
  run_score: number
  title: string
}

export interface RecordPage {
  total_num: number
  total_score_num: number
  total_distance: number
  total_score_distance: number
  list: RunRecord[]
}

export interface TrackPointDTO {
  a: number
  o: number
  s: number
  l?: number
  p?: number
}

export interface TrackCheckpoint {
  id: string
  lat: number
  lng: number
  name: string
  hit: boolean
}

export interface TrackStats {
  distanceKm: number
  durationSec: number
  paceSecPerKm: number
  maxSpeed: number
  avgSpeed: number
  pointCount: number
  noisePct: number
}

export type DiagLevel = 'pass' | 'warn' | 'fail'

export interface DiagnosticItem {
  key: string
  label: string
  level: DiagLevel
  value: string
  detail: string
}

export interface Verdict {
  pass: boolean
  reasons: string[]
}

export interface TrackBlock {
  points: TrackPointDTO[]
  checkpoints: TrackCheckpoint[]
  stats: TrackStats
  diagnostics: DiagnosticItem[]
}

export interface RecordRaw {
  id?: string
  start_time?: string
  end_time?: string
  distance?: number
  used_time?: number
  record_status?: number
  run_score?: number
  step_num?: number
  title?: string
  run_zone_name?: string
  record_failed_reason?: string
  [k: string]: unknown
}

export interface RecordDetail {
  record: RecordRaw
  track: TrackBlock
}

export interface ZoneInfo {
  id: string
  name: string
}

export interface ZoneRules {
  minDistanceKm: number
  maxDistanceKm: number
  minPaceSec: number
  maxPaceSec: number
  minLogNum: number
  pointNumOnline: number
  runStartTime: string
  runEndTime: string
  isCheckTime: boolean
}

export interface ZoneCheckpoint {
  id: string
  name: string
  lat: number
  lng: number
}

export interface ZonePayload {
  zone: ZoneInfo
  rules: ZoneRules
  checkpoints: ZoneCheckpoint[]
}

export interface PreviewRequest {
  targetKm: number
  paceSec: number
  seed: number | null
  startAt: string
  startMode?: 'now' | 'at'
  path: Array<[number, number]>
  radius?: number
  noisePct?: number
  mustHit?: string[]
  hitRadius?: number
}

export interface TimeCheck {
  startAt: number
  endAt: number
  usedTime: number
  spanSlack?: number
  startText: string
  endText: string
  mode?: 'now' | 'at'
  note: string
}

export interface PreviewResponse extends TrackBlock {
  verdict: Verdict
  timeCheck?: TimeCheck
  mode?: 'manual'
  pinned?: Array<{ id: string; idx: number; geoDist: number }>
  snapped?: Array<{ id: string; name: string; distM: number; mode: string }>
  detour?: Array<{ id: string; name: string; distM: number; mode: string }>
  noiseTarget?: number
  noiseActual?: number
  pathLengthM?: number | null
  loops?: number | null
  missed?: Array<{ id: string; name: string; distM: number | null }>
  anchored?: Array<{ id: string; name: string; index: number }>
  playSec?: number
  hitCount?: number
}

export interface SubmitStep {
  step: string
  label: string
  state: 'ok' | 'fail' | 'skip'
  detail: string
  ms: number
}

export interface SubmitStatus {
  state: 'running' | 'done' | 'failed'
  steps: SubmitStep[]
  verdict: Verdict
}

export interface SubmitCreated {
  submitId: string
}

export interface FridaDetail {
  ready: boolean
  reason: string
  server: boolean
  port: boolean
  client: boolean
  serverPid: number | null
  appPid: number | null
  serial?: string
}

export interface AdbDevice {
  serial: string
  state: string
  model?: string
  product?: string
  tcp?: boolean
}

export interface BridgeStatus {
  up: boolean
  port: number
  device?: string | null
  root?: boolean
  hasSession?: boolean
}

export interface AdbProbe {
  bin: string
  found: boolean
  fromPath: boolean
  isExe: boolean
  exeDir: string | null
  resolved?: string
  candidates: { path: string; exists: boolean }[]
}

export interface DeviceStatus {
  adb: boolean
  adbDetail?: AdbProbe | null
  adbError?: string | null
  serial: string | null
  devices?: AdbDevice[]
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  frida: boolean
  fridaDetail?: FridaDetail
  analysis?: { runner?: boolean; agent?: boolean; feed?: boolean }
  appForeground: string | null
  appPid?: number | null
  windowOpen: boolean | null
  now: number
  runWindow: [string, string] | null
  bridge?: BridgeStatus
}

export interface AdbConnectResult {
  ok: boolean
  target: string
  text: string
  serial: string | null
  missing?: boolean
  status?: DeviceStatus
}

export interface DeviceRunState {
  id: string
  state: 'running' | 'done' | 'stopped' | 'failed'
  mode?: 'frida' | 'provider' | 'idle'
  injected: number
  total: number
  distanceKm: number
  elapsedSec: number
  log: string[]
}

export interface DeviceRunCreated {
  runId: string
}

export interface HealthInfo {
  ok: boolean
  version: string
}
