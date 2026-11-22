export function readVarint (buf, off) {
  let result = 0
  let shift = 0
  let pos = off
  while (pos < buf.length) {
    const b = buf[pos++]
    result |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) return [result >>> 0, pos]
    shift += 7
    if (shift > 35) return [null, off]
  }
  return [null, off]
}

function decodeString (raw) {
  const utf8 = raw.toString('utf8')
  if (!/\uFFFD/.test(utf8)) return utf8
  const utf16 = raw.toString('utf16le')
  if (!/\uFFFD/.test(utf16) && /[\u4e00-\u9fa5A-Za-z0-9]/.test(utf16)) return utf16
  return raw.toString('latin1')
}

const KEY_RE = /^[\x20-\x7e]{1,200}$/

function parseFrom (buf, start) {
  const out = []
  let off = start
  while (off < buf.length) {
    const [kLen, afterKeyLen] = readVarint(buf, off)
    if (kLen === null || kLen === 0 || kLen > 512 || afterKeyLen + kLen > buf.length) break
    const key = buf.subarray(afterKeyLen, afterKeyLen + kLen).toString('utf8')
    if (!KEY_RE.test(key)) break
    const off2 = afterKeyLen + kLen
    const [vLen, afterVLen] = readVarint(buf, off2)
    if (vLen === null || afterVLen + vLen > buf.length) break
    const raw = Buffer.from(buf.subarray(afterVLen, afterVLen + vLen))
    out.push({ key, raw, offset: off })
    off = afterVLen + vLen
  }
  return out
}

function stringOf (raw) {
  if (raw.length < 2) return null
  const [n, next] = readVarint(raw, 0)
  if (n === null || n === 0 || next !== 1 || n + 1 !== raw.length) return null
  const body = raw.subarray(1)
  const s = decodeString(body)
  const bad = [...s].filter((ch) => ch.charCodeAt(0) < 9).length
  if (bad > 0) return null
  return s
}

function numberOf (raw) {
  if (!raw.length || raw.length > 5) return null
  const [v, next] = readVarint(raw, 0)
  if (v === null || next !== raw.length) return null
  return v
}

export function parseMmkv (buf) {
  let best = { entries: [], start: 0 }
  for (let start = 0; start <= Math.min(32, buf.length); start++) {
    const entries = parseFrom(buf, start)
    if (entries.length > best.entries.length) best = { entries, start }
  }
  const entries = best.entries.map((e) => {
    const str = stringOf(e.raw)
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    const int = str === null ? numberOf(e.raw) : (/^-?\d+$/.test(str) ? Number(str) : null)
    return { ...e, str: str ?? (int !== null ? String(int) : e.raw.toString('latin1')), int }
  })
  return { entries, start: best.start, crcTail: entries.length > 0 }
}

export function mmkvLast (entries, key) {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].key === key) return entries[i]
  return null
}

export function mmkvLastBy (entries, re) {
  for (let i = entries.length - 1; i >= 0; i--) if (re.test(entries[i].key)) return entries[i]
  return null
}

export function valueAsNumber (entry) {
  if (!entry) return null
  if (entry.int !== null && entry.int !== undefined) return entry.int
  const t = String(entry.str ?? '').trim()
  return /^-?\d{1,12}$/.test(t) ? Number(t) : null
}
