const TOKEN_HEX = /(?<![0-9A-Za-z])[0-9A-F]{32}(?![0-9A-Za-z])/g
const TOKEN_HEX_LOOSE = /(?<![0-9A-Za-z])[0-9a-f]{32}(?![0-9A-Za-z])/g

const KEY_TOKEN = /^(?:user_?)?(?:token|access_?token|auth_?token|lp_?token)$/i
const KEY_REFRESH = /^refresh_?token$/i
const KEY_UID = /^(?:uid|user_?id|userid|account_?id|member_?id|stu_?id)$/i
const KEY_STUDENT = /^(?:student_?num|student_?no|student_?number|stu_?num|student_?code|xh|user_num)$/i
const KEY_SCHOOL = /^(?:school_?id|schoolid|school_?code)$/i
const KEY_DEVICE = /^(?:mobile_?device_?id|device_?id|device_?uuid|andriod_?id|android_?id|imei|oaid|idfa|udid)$/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const KEYLIKE = /^[a-z][A-Za-z0-9_]{1,31}$/
const VALUE_SAFE = /^[!-~][ -~]{0,255}$/

const PB_TAGS = new Set([0x0a, 0x12, 0x1a, 0x22, 0x2a, 0x32, 0x3a, 0x42, 0x4a, 0x52])

function readVarint(buf, i) {
  let v = 0
  let shift = 0
  for (let k = 0; k < 5 && i < buf.length; k++) {
    const b = buf[i++]
    v |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) return [v >>> 0, i]
    shift += 7
  }
  return null
}

const printable = (buf, from, len) => {
  let ok = 0
  for (let i = from; i < from + len; i++) {
    const b = buf[i]
    if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b < 0x7f) || b >= 0xc0) ok++
  }
  return ok / len > 0.92
}

const MMKV_TAGS = new Set([...PB_TAGS, 0x04, 0x05, 0x11, 0x21, 0x31])

export function scanPbStrings(buf, enc = 'utf8') {
  const out = []
  if (enc === 'utf16le') {
    for (let i = 0; i < buf.length - 3; i += 2) {
      const tag = buf[i]
      if (tag !== 0x0a && tag !== 0x12) {
        if (!MMKV_TAGS.has(tag)) continue
      }
      if (buf[i + 1] !== 0x00) continue
      const v = readVarint(buf, i + 2)
      if (!v) continue
      const [chars, start] = v
      if (chars < 1 || chars > 4096) continue
      const len = chars * 2
      if (start + len > buf.length) continue
      const text = buf.toString('utf16le', start, start + len)
      if (!/^[\x20-\x7e]+$/.test(text)) continue
      out.push({ offset: i, tag, size: len, text })
      i = start + len - 2
    }
    return out
  }
  for (let i = 0; i < buf.length - 2; i++) {
    const tag = buf[i]
    if (!MMKV_TAGS.has(tag)) continue
    const v = readVarint(buf, i + 1)
    if (!v) continue
    const [len, start] = v
    if (len < 1 || len > 8192 || start + len > buf.length) continue
    if (!printable(buf, start, len)) continue
    out.push({
      offset: i,
      tag,
      size: len,
      text: buf.toString('utf8', start, start + len),
    })
    i = start + len - 1
  }
  return out
}

export function scanTextPairs(text) {
  const out = []
  const push = (key, value, offset) => {
    if (!key || !value) return
    out.push({ key, value, offset })
  }

  for (const m of text.matchAll(/<(\w+)\s+name="([^"]+)"\s*(?:value="([^"]*)")?[^>]*>([^<]*)</g)) {
    push(m[2], (m[3] ?? m[4] ?? '').trim(), m.index)
  }
  for (const m of text.matchAll(/["']?([A-Za-z_][A-Za-z0-9_]{1,24})["']?\s*[:=]\s*["']?([^"',&}\s<]{1,200})/g)) {
    push(m[1], m[2], m.index)
  }
  for (const m of text.matchAll(/([a-z][A-Za-z0-9_]{1,31})[^\w]{1,6}?([0-9A-Fa-f]{32})(?![0-9A-Za-z])/g)) {
    push(m[1], m[2], m.index)
  }
  return out
}

const isToken = (v) => /^[0-9A-Fa-f]{32}$/.test(v)
const digits = (v) => /^\d{1,15}$/.test(v)

function pairsFromSequence(items, source, ctxOf, offsetsAre16) {
  const pairs = []
  for (let i = 0; i < items.length; i++) {
    const k = items[i]?.text ?? ''
    if (!KEYLIKE.test(k)) continue
    const v = items[i + 1]?.text ?? ''
    if (!VALUE_SAFE.test(v)) continue
    const off = offsetsAre16 ? items[i].offset / 2 : items[i].offset
    pairs.push({ key: k, value: v, offset: off, source, ctx: ctxOf(off) })
  }
  return pairs
}

export function extractFromBuffer(buf, opts = {}) {
  const source = opts.source ?? '<buffer>'

  const ctxOf = (charOffset, before = 56, after = 72) => {
    if (charOffset == null || charOffset < 0) return ''
    const from = Math.max(0, charOffset - before)
    const chars = new Array(after + before)
    let n = 0
    for (let i = 0; i < after + before; i++) {
      const at = (from + i) * 2
      if (at + 1 >= buf.length) break
      const c = buf[at] | (buf[at + 1] << 8)
      if (c >= 0x20 && c < 0x7f) {
        chars[n++] = String.fromCharCode(c)
      } else if (c === 0) {
        continue
      }
    }
    return String(chars.slice(0, n).join('')).replace(/\s{2,}/g, ' ').trim().slice(0, 160)
  }

  const ctxOfBytes = (offset, before = 56, after = 72) => {
    if (offset == null) return ''
    const from = Math.max(0, offset - before)
    const to = Math.min(buf.length, offset + after)
    return buf
      .toString('latin1', from, to)
      .replace(/[^\x20-\x7e]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 160)
  }

  const probeLen = Math.min(buf.length, 8192) & ~1
  let evenOk = 0
  let oddZero = 0
  for (let i = 0; i < probeLen; i += 2) {
    const lo = buf[i]
    const hi = buf[i + 1]
    if (lo >= 0x20 && lo < 0x7f) evenOk++
    if (hi === 0) oddZero++
  }
  const half = Math.max(1, probeLen / 2)
  const isUtf16 = probeLen > 0 && oddZero / half > 0.75 && evenOk / half > 0.6

  const pairs = []

  const pairsText = pairsFromSequence(scanPbStrings(buf, 'utf16le'), source, ctxOf, true)
  const pairsBytes = pairsFromSequence(scanPbStrings(buf, 'utf8'), source, ctxOfBytes, false)
  pairs.push(...(isUtf16 ? [...pairsText, ...pairsBytes] : [...pairsBytes, ...pairsText]))

  pairs.push(...scanTextPairs(buf.toString('latin1')))
  pairs.push(...scanTextPairs(buf.toString('utf16le')))

  const tokens = []
  const refreshes = []
  const uids = []
  const studentNums = []
  const schoolIds = []
  const deviceIds = []
  let currentRefresh = ''

  const addToken = (value, key, offset, confidence, ctx) => {
    const v = value.trim()
    if (!isToken(v)) return
    if (tokens.some((t) => t.value.trim().toUpperCase() === v.toUpperCase())) return
    tokens.push({ value: v, key: key ?? null, offset, source, confidence, ctx: ctx ?? ctxOfBytes(offset) })
  }

  for (const p of pairs) {
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    const key = p.key?.trim()
    const value = p.value?.trim()
    if (!key || !value) continue
    if (KEY_REFRESH.test(key) && isToken(value)) {
      refreshes.push({ value, key, offset: p.offset, source, ctx: p.ctx })
      if (isToken(value)) currentRefresh = value
    } else if (KEY_TOKEN.test(key) && isToken(value)) {
      addToken(value, key, p.offset, 'key', p.ctx)
      const added = tokens[tokens.length - 1]
      if (added && currentRefresh && !added.refresh_of) added.refresh_of = currentRefresh
    } else if (KEY_UID.test(key) && digits(value)) {
      uids.push({ value: Number(value), key, offset: p.offset, source, ctx: p.ctx })
    } else if (KEY_STUDENT.test(key) && digits(value)) {
      studentNums.push({ value, key, offset: p.offset, source, ctx: p.ctx })
    } else if (KEY_SCHOOL.test(key) && digits(value)) {
      schoolIds.push({ value: Number(value), key, offset: p.offset, source, ctx: p.ctx })
    } else if (KEY_DEVICE.test(key) && (UUID_RE.test(value) || /^[0-9a-f]{16}$/i.test(value) || isToken(value))) {
      deviceIds.push({ value, key, offset: p.offset, source, ctx: p.ctx })
    }
  }

  const text = isUtf16 ? buf.toString('utf16le') : buf.toString('utf8')
  for (const m of text.matchAll(TOKEN_HEX)) addToken(m[0], null, m.index, 'raw', ctxOf(m.index))
  for (const m of text.matchAll(TOKEN_HEX_LOOSE)) addToken(m[0], null, m.index, 'raw-lower', ctxOf(m.index))

  const APP_DEVICE_RE = /\b(00000000-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi
  for (const m of text.matchAll(APP_DEVICE_RE)) {
    const v = m[1].toLowerCase()
    if (/^00000000-0000-0000-0000-000000000000$/.test(v)) continue
    if (deviceIds.some((d) => String(d.value).toLowerCase() === v)) continue
    deviceIds.push({ value: v, key: 'app-device-id', offset: m.index, source, ctx: ctxOf(m.index), confidence: 'app' })
  }

  const ANY_UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
  for (const m of text.matchAll(ANY_UUID_RE)) {
    const v = m[0].toLowerCase()
    if (/^00000000-0000-0000-0000-000000000000$/.test(v)) continue
    if (deviceIds.some((d) => String(d.value).toLowerCase() === v)) continue
    const ctx = (isUtf16 ? ctxOf(m.index) : ctxOfBytes(m.index)) || ''
    if (!/device|uuid|udid|oaid|idfa|mobile|finger|dev_?id/i.test(ctx)) continue
    deviceIds.push({ value: v, key: 'uuid-ctx', offset: m.index, source, ctx, confidence: 'app' })
  }

  const squashed = buf.length <= 4 * 1024 * 1024 ? Buffer.from(buf.filter((b) => b !== 0)).toString('latin1') : ''
  for (const m of squashed.matchAll(ANY_UUID_RE)) {
    const v = m[0].toLowerCase()
    if (/^00000000-0000-0000-0000-000000000000$/.test(v)) continue
    if (deviceIds.some((d) => String(d.value).toLowerCase() === v)) continue
    if (!/device|uuid|udid|oaid|idfa|mobile|finger|dev_?id/i.test(squashed.slice(Math.max(0, m.index - 40), m.index + 40))) continue
    deviceIds.push({ value: v, key: 'uuid-raw', offset: m.index, source, confidence: 'app' })
  }

  const rank = { key: 0, raw: 1, 'raw-lower': 2 }
  tokens.sort((a, b) => (rank[a.confidence] ?? 9) - (rank[b.confidence] ?? 9))

  return { source, tokens, refreshes, uids, studentNums, schoolIds, deviceIds, utf16: isUtf16 }
}

export function mergeCandidates(list) {
  const out = { tokens: [], refreshes: [], uids: [], studentNums: [], schoolIds: [], deviceIds: [] }
  const seen = {
    tokens: new Set(),
    refreshes: new Set(),
    uids: new Set(),
    studentNums: new Set(),
    schoolIds: new Set(),
    deviceIds: new Set(),
  }
  for (const r of list) {
    for (const k of Object.keys(out)) {
      for (const item of r?.[k] ?? []) {
        const id = k === 'tokens' || k === 'refreshes' ? String(item.value).toUpperCase() : String(item.value)
        if (seen[k].has(id)) continue
        seen[k].add(id)
        out[k].push(item)
      }
    }
  }
  const rank = { key: 0, raw: 1, 'raw-lower': 2 }
  out.tokens.sort((a, b) => (rank[a.confidence] ?? 9) - (rank[b.confidence] ?? 9))
  return out
}

export function buildCombo(cands, { uid } = {}) {
  const u = Number(uid) || 0
  if (!u) return null
  const top = cands.tokens[0]
  if (!top) return null
  return {
    token: top.value,
    uid: u,
    confidence: top.confidence,
    source: top.source,
    key: top.key,
  }
}
