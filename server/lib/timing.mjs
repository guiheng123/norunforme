export const SPAN_SLACK = 115

const pad = (n) => String(n).padStart(2, '0')

export function clockOf (ts) {
  const d = new Date(Number(ts) * 1000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function parseLocalTs (text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text || ''))
  if (!m) return 0
  const [, y, mo, d, h, mi, se] = m
  const t = new Date(+y, +mo - 1, +d, +h, +mi, +(se || 0)).getTime()
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0
}

export function planTiming ({
  wantedTs = 0,
  usedTime = 0,
  nowTs = Math.floor(Date.now() / 1000),
  mode = 'now',
  slack = SPAN_SLACK,
} = {}) {
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  const used = Math.max(60, Math.round(Number(usedTime) || 0))
  const now = Math.round(Number(nowTs) || Math.floor(Date.now() / 1000))
  const wanted = Math.round(Number(wantedTs) || 0)
  const spanSlack = Math.max(0, Math.round(Number(slack) || SPAN_SLACK))
  const exact = mode === 'at' && wanted > 0

  const startTs = exact ? wanted : now - used - spanSlack
  const endTs = exact ? wanted + used + spanSlack : now
  const note = exact
    ? `按「开始时间」${clockOf(startTs)} 起跑，${clockOf(endTs)} 停表`
    : `以当前时刻为锚倒推：${clockOf(startTs)} 起跑、${clockOf(endTs)} 停表`

  return { startTs, endTs, usedTime: used, spanSlack, mode: exact ? 'at' : 'now', note }
}

export function resolveStart ({ meta = {}, usedTime = 0, nowTs = Math.floor(Date.now() / 1000) } = {}) {
  const used = Math.max(60, Math.round(Number(usedTime) || 0))
  const now = Math.round(Number(nowTs) || Math.floor(Date.now() / 1000))
  const fromText = parseLocalTs(meta.startAt)
  const fromTs = Math.round(Number(meta.startTs) || 0)
  const wantedTs = fromText > 0 ? fromText : fromTs

  const flag = meta.startMode === 'at' ? 'at' : meta.startMode === 'now' ? 'now' : ''
  let mode
  if (flag) {
    mode = flag
  } else if (wantedTs > 0 && wantedTs + used + SPAN_SLACK <= now) {
    mode = 'at'
  } else {
    mode = 'now'
  }
  return { wantedTs: mode === 'at' ? wantedTs : 0, usedTime: used, mode, legacy: !flag }
}
