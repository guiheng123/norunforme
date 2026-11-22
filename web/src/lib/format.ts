const DASH = '--'

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function fmtKm(v: unknown, digits = 2): string {
  const n = num(v)
  if (n === null) return DASH
  return n.toFixed(digits)
}

export function fmtDistance(v: unknown, digits = 2): string {
  const n = num(v)
  if (n === null) return DASH
  return `${n.toFixed(digits)} km`
}

export function fmtPace(secPerKm: unknown): string {
  const n = num(secPerKm)
  if (n === null || n <= 0 || !Number.isFinite(n)) return DASH
  const total = Math.round(n)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}'${String(s).padStart(2, '0')}"`
}

export function fmtPaceOf(km: unknown, sec: unknown): string {
  const d = num(km)
  const t = num(sec)
  if (d === null || t === null || d <= 0 || t <= 0) return DASH
  return fmtPace(t / d)
}

export function paceToInput(secPerKm: unknown): string {
  const n = num(secPerKm)
  if (n === null || n <= 0) return ''
  const total = Math.round(n)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function parsePace(text: string): number | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const s = raw.replace(/["'’″]/g, ':').replace(/\s+/g, ':').replace(/:+/g, ':')
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    return n > 0 ? Math.round(n) : null
  }
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/)
  if (!m) return null
  const sec = Number(m[1]) * 60 + Number(m[2])
  return sec > 0 ? sec : null
}

export function fmtDuration(sec: unknown): string {
  const n = num(sec)
  if (n === null || n < 0) return DASH
  const total = Math.round(n)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtDurationCn(sec: unknown): string {
  const n = num(sec)
  if (n === null || n < 0) return DASH
  const total = Math.round(n)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${String(s).padStart(2, '0')} 秒`
  return `${s} 秒`
}

export function fmtMinutes(sec: unknown): string {
  const n = num(sec)
  if (n === null) return DASH
  return (n / 60).toFixed(1)
}

export function fmtInt(v: unknown): string {
  const n = num(v)
  if (n === null) return DASH
  return Math.round(n).toLocaleString('zh-CN')
}

export function fmtFixed(v: unknown, digits = 2): string {
  const n = num(v)
  if (n === null) return DASH
  return n.toFixed(digits)
}

export function fmtPct(v: unknown, digits = 1): string {
  const n = num(v)
  if (n === null) return DASH
  return `${n.toFixed(digits)}%`
}

export function fmtDelta(v: unknown, digits = 1): string {
  const n = num(v)
  if (n === null) return '--'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(digits)}%`
}

export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') {
    const ms = v > 1e12 ? v : v * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const s = String(v).trim()
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    const ms = n > 1e12 ? n : n * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const normalized = /[T ]/.test(s) ? s.replace(' ', 'T') : s
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function fmtDateTime(v: unknown): string {
  const d = toDate(v)
  if (!d) return DASH
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}`
}

export function fmtShortDateTime(v: unknown): string {
  const d = toDate(v)
  if (!d) return DASH
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function fmtClock(v: unknown): string {
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  const d = toDate(v)
  if (!d) return DASH
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function fmtWindowValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return DASH
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return DASH
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5)
    if (/^\d{3,4}$/.test(s)) {
      const h = Number(s.slice(0, s.length - 2))
      const m = Number(s.slice(-2))
      if (h >= 0 && h < 24 && m >= 0 && m < 60) return `${pad2(h)}:${pad2(m)}`
    }
    const d = toDate(s)
    return d ? fmtClock(d) : s
  }
  const n = num(v)
  if (n === null) return DASH
  if (n >= 1e12 || n >= 1e9) {
    const d = toDate(n)
    return d ? fmtClock(d) : DASH
  }
  if (n >= 0 && n < 24) return `${pad2(Math.round(n))}:00`
  if (n >= 100 && n < 2400) {
    const h = Math.floor(n / 100)
    const m = n % 100
    if (h < 24 && m < 60) return `${pad2(h)}:${pad2(m)}`
  }
  return String(n)
}

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

export function recordStatusOf(v: unknown): { text: string; tone: Tone } {
  if (typeof v === 'string' && !/^-?\d+$/.test(v.trim())) {
    const s = v.trim().toLowerCase()
    if (['valid', 'ok', 'pass', 'success'].includes(s)) return { text: '有效', tone: 'success' }
    if (['pending', 'review', 'wait', 'audit'].includes(s)) return { text: '待审', tone: 'warning' }
    if (s) return { text: '无效', tone: 'danger' }
  }
  const n = num(v)
  if (n === 1) return { text: '有效', tone: 'success' }
  if (n === 0) return { text: '待审', tone: 'warning' }
  if (n === null) return { text: '未知', tone: 'neutral' }
  return { text: '无效', tone: 'danger' }
}

export function diagTone(level: string): Tone {
  if (level === 'pass') return 'success'
  if (level === 'warn') return 'warning'
  if (level === 'fail') return 'danger'
  return 'neutral'
}

export function fmtRelative(v: unknown): string {
  const d = toDate(v)
  if (!d) return DASH
  const diff = Date.now() - d.getTime()
  if (diff < 0) return '刚刚'
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return fmtShortDateTime(d)
}

export function ellipsis(v: string, head = 6, tail = 4): string {
  const s = String(v ?? '')
  if (s.length <= head + tail + 3) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
