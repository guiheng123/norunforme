import { markDemo, markLive, markMock, netState } from '../lib/net'
import { isDemoToken } from '../lib/demo'
import { store } from '../store'
import { mockResolve } from './mock'
import type { ApiEnvelope } from './types'

export class ApiError extends Error {
  code: string
  hint?: string
  status: number

  constructor(code: string, message: string, opts: { hint?: string; status?: number } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.hint = opts.hint
    this.status = opts.status ?? 0
  }
}

export interface ApiResult<T> {
  data: T
  offline: boolean
}

const DEFAULT_TIMEOUT = 20000

function buildUrl(path: string): string {
  const base = String(netState.apiBase || '').trim().replace(/\/+$/, '')
  if (!base) return path
  if (/^https?:\/\//i.test(path)) return path
  return `${base}${path}`
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message || '请求失败'
  return '请求失败'
}

export function errorHint(e: unknown): string {
  return e instanceof ApiError ? e.hint ?? '' : ''
}

interface RawResponse {
  status: number
  text: string
}

async function rawRequest(
  method: string,
  path: string,
  body: unknown,
  timeout: number,
): Promise<RawResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    let payload: string | undefined
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(buildUrl(path), {
      method,
      headers,
      body: payload,
      signal: controller.signal,
      credentials: 'same-origin',
    })
    const text = await res.text()
    return { status: res.status, text }
  } finally {
    clearTimeout(timer)
  }
}

export async function request<T>(
  method: string,
  path: string,
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  body?: unknown,
  opts: { timeout?: number } = {},
): Promise<ApiResult<T>> {
  if (isDemoToken(store.session?.token)) {
    const demo = mockResolve<T>(method, path, body)
    if (demo !== undefined) {
      markDemo()
      return { data: demo, offline: true }
    }
    throw new ApiError('DEMO_UNSUPPORTED', `演示账号暂未内置该接口：${method} ${path}`, {
      hint: '演示模式覆盖概览、记录、跑区、模拟跑步、提交与设备状态；需要完整链路请用真实会话登录',
    })
  }

  let raw: RawResponse | null = null
  try {
    raw = await rawRequest(method, path, body, opts.timeout ?? DEFAULT_TIMEOUT)
  } catch {
    raw = null
  }

  if (raw) {
    let envelope: ApiEnvelope<T> | null = null
    try {
      const parsed: unknown = JSON.parse(raw.text)
      if (parsed && typeof parsed === 'object' && typeof (parsed as { ok?: unknown }).ok === 'boolean') {
        envelope = parsed as ApiEnvelope<T>
      }
    } catch {
      envelope = null
    }

    if (envelope) {
      if (envelope.ok) {
        markLive()
        return { data: envelope.data as T, offline: false }
      }
      const err = envelope.error
      throw new ApiError(err?.code ?? 'UNKNOWN', err?.message ?? '请求失败', {
        hint: err?.hint,
        status: raw.status,
      })
    }
  }

  const mocked = mockResolve<T>(method, path, body)
  if (mocked !== undefined) {
    markMock()
    return { data: mocked, offline: true }
  }

  markMock()
  throw new ApiError('OFFLINE', '后端未就绪，且本地演示数据未覆盖该接口', {
    hint: '请确认本地 API 服务已启动（默认 http://127.0.0.1:8787）',
  })
}

export function get<T>(path: string, opts: { timeout?: number } = {}): Promise<ApiResult<T>> {
  return request<T>('GET', path, undefined, opts)
}

export function post<T>(path: string, body?: unknown, opts: { timeout?: number } = {}): Promise<ApiResult<T>> {
  return request<T>('POST', path, body, opts)
}

export function del<T>(path: string, opts: { timeout?: number } = {}): Promise<ApiResult<T>> {
  return request<T>('DELETE', path, undefined, opts)
}
