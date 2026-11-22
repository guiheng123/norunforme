import { del, get, post, type ApiResult } from './http'
import type {
  AdbConnectResult,
  DeviceRunCreated,
  DeviceRunState,
  DeviceStatus,
  FridaDetail,
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  HealthInfo,
  PreviewRequest,
  PreviewResponse,
  RecordDetail,
  RecordPage,
  SessionHealth,
  SessionPayload,
  SubmitCreated,
  SubmitStatus,
  Term,
  TrackPointDTO,
  TrackCheckpoint,
  ZonePayload,
} from './types'

export { ApiError, errorHint, errorText } from './http'
export type { ApiResult } from './http'

export interface LoginBody {
  token: string
  uid: number
  school_id: number
  student_num: string
  mobileModel: string
  mobileDeviceId: string
  mobileOsVersion: string
}

export function login(body: LoginBody): Promise<ApiResult<SessionPayload>> {
  return post<SessionPayload>('/api/session', body)
}

export function fetchSession(): Promise<ApiResult<SessionPayload>> {
  return get<SessionPayload>('/api/session', { timeout: 8000 })
}

export function fetchSessionHealth(): Promise<ApiResult<SessionHealth>> {
  return get<SessionHealth>('/api/session/health', { timeout: 8000 })
}

export function deleteSession(): Promise<
  ApiResult<{
    cleared: boolean
    hadSession: boolean
    purged: string[]
    fileRemoved?: boolean
    fileEmptied?: boolean
    fileExists?: boolean
  }>
> {
  return del<{
    cleared: boolean
    hadSession: boolean
    purged: string[]
    fileRemoved?: boolean
    fileEmptied?: boolean
    fileExists?: boolean
  }>('/api/session', { timeout: 15000 })
}

export function syncSession(opts: { live?: boolean; uid?: number; serial?: string } = {}): Promise<ApiResult<SessionPayload>> {
  const qs = new URLSearchParams()
  if (opts.live) qs.set('live', '1')
  if (opts.uid) qs.set('uid', String(opts.uid))
  if (opts.serial) qs.set('serial', opts.serial)
  const q = qs.toString()
  return get<SessionPayload>(`/api/session/sync${q ? `?${q}` : ''}`, { timeout: opts.live ? 90000 : 20000 })
}

export function fetchTerms(): Promise<ApiResult<Term[]>> {
  return get<Term[]>('/api/terms')
}

export function fetchRecords(
  termId: string,
  page = 1,
  pageSize = 10,
): Promise<ApiResult<RecordPage>> {
  const qs = new URLSearchParams({
    term_id: String(termId ?? ''),
    page: String(page),
    pageSize: String(pageSize),
  })
  return get<RecordPage>(`/api/records?${qs.toString()}`)
}

export function fetchRecordDetail(id: string, yearNum?: number): Promise<ApiResult<RecordDetail>> {
  const qs = yearNum ? `?year_num=${yearNum}` : ''
  return get<RecordDetail>(`/api/records/${encodeURIComponent(id)}${qs}`)
}

export function fetchZone(): Promise<ApiResult<ZonePayload>> {
  return get<ZonePayload>('/api/zone')
}

export function previewTrack(body: PreviewRequest): Promise<ApiResult<PreviewResponse>> {
  return post<PreviewResponse>('/api/track/preview', body, { timeout: 30000 })
}

export interface SubmitBody {
  points: TrackPointDTO[]
  checkpoints: TrackCheckpoint[]
  meta: Record<string, unknown>
}

export function submitTrack(body: SubmitBody): Promise<ApiResult<SubmitCreated>> {
  return post<SubmitCreated>('/api/submit', body, { timeout: 30000 })
}

export function fetchSubmit(id: string): Promise<ApiResult<SubmitStatus>> {
  return get<SubmitStatus>(`/api/submit/${encodeURIComponent(id)}`)
}

export function fetchDeviceStatus(): Promise<ApiResult<DeviceStatus>> {
  return get<DeviceStatus>('/api/device/status', { timeout: 20000 })
}

export function connectDevice(host: string): Promise<ApiResult<AdbConnectResult>> {
  return post<AdbConnectResult>('/api/device/connect', { host }, { timeout: 30000 })
}

export function startDeviceRun(
  points: TrackPointDTO[],
  startAt: string,
): Promise<ApiResult<DeviceRunCreated>> {
  return post<DeviceRunCreated>('/api/device/run', { points, startAt }, { timeout: 30000 })
}

export function startFrida(): Promise<ApiResult<FridaDetail>> {
  return post<FridaDetail>('/api/device/frida/start', {}, { timeout: 60000 })
}

export function stopFrida(): Promise<ApiResult<FridaDetail>> {
  return post<FridaDetail>('/api/device/frida/stop', {}, { timeout: 30000 })
}

export function probeFrida(): Promise<ApiResult<FridaDetail>> {
  return post<FridaDetail>('/api/device/probe', {}, { timeout: 30000 })
}

export function fetchDeviceRun(id: string): Promise<ApiResult<DeviceRunState>> {
  return get<DeviceRunState>(`/api/device/run/${encodeURIComponent(id)}`, { timeout: 8000 })
}

export function stopDeviceRun(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return post<{ ok: boolean }>(`/api/device/run/${encodeURIComponent(id)}/stop`, {})
}

export function fetchHealth(): Promise<ApiResult<HealthInfo>> {
  return get<HealthInfo>('/api/health', { timeout: 5000 })
}
