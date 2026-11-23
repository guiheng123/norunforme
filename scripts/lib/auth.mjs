import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataRoot } from '../../server/lib/paths.mjs'
import { makeClient } from './track-analysis.mjs'
import { extractFromBuffer, mergeCandidates, buildCombo } from './creds-scan.mjs'
import { parseMmkv, mmkvLast, valueAsNumber } from './mmkv.mjs'
import {
  PKG,
  listDevices,
  pickDevice,
  hasRoot,
  listTree,
  parseLsTree,
  rootCat,
  catFile,
  runAsCat,
  dumpLogcat,
  grepFiles,
  runAdb,
  resolveAdb,
  shellRoot,
  deviceInfo,
  launchApp,
  connectHost,
  currentActivity,
} from './adb.mjs'

const PRIORITY_DIRS = ['shared_prefs', 'files/mmkv', 'files', 'databases', 'cache', 'app_webview']
const EXTERNAL_DIRS = [
  `/sdcard/Android/data/${PKG}`,
  '/sdcard/lptiyu',
  '/sdcard/lepao',
  '/sdcard/LpTiyu',
]
const MAX_FILE = 512 * 1024
const MAX_DIR_FILE = 8 * 1024 * 1024
const MAX_FILES = 60
const SKIP_EXT = /\.(png|jpe?g|webp|gif|so|dex|apk|mp4|ttf|otf|zip|jar|dat|bin|vdata|prof)$/i

export const FINGERPRINT_KEYS = ['mobileModel', 'mobileDeviceId', 'mobileOsVersion']

export function hasFingerprint(s) {
  return Boolean(
    s &&
      String(s.mobileModel ?? '').trim() &&
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
      String(s.mobileOsVersion ?? '').trim() &&
      s.mobileDeviceId !== undefined &&
      s.mobileDeviceId !== null,
  )
}

export function missingFingerprint(s) {
  const miss = []
  if (!String(s?.mobileModel ?? '').trim()) miss.push('mobileModel')
  if (!String(s?.mobileOsVersion ?? '').trim()) miss.push('mobileOsVersion')
  if (s?.mobileDeviceId === undefined || s?.mobileDeviceId === null) miss.push('mobileDeviceId')
  return miss
}

export function normalizeSession(s) {
  const raw = Object.fromEntries(
    Object.entries(s || {}).filter(([, v]) => v != null && String(v).trim() !== ''),
  )
  const keepId = s && s.mobileDeviceId != null ? String(s.mobileDeviceId).trim() : undefined
  return {
    ...raw,
    mobileModel: s?.mobileModel != null ? String(s.mobileModel).trim() : undefined,
    mobileDeviceId: keepId,
    mobileOsVersion: s?.mobileOsVersion != null ? String(s.mobileOsVersion).trim() : undefined,
    uid: Number(s?.uid) || 0,
    school_id: Number(s?.school_id) || 0,
    student_num: s?.student_num == null ? '' : String(s.student_num),
  }
}

function pickFingerprint(s) {
  return {
    mobileModel: s.mobileModel,
    mobileDeviceId: s.mobileDeviceId,
    mobileOsVersion: s.mobileOsVersion,
  }
}

export const ZERO_DEVICE_ID = '00000000-0000-0000-0000-000000000000'
export const DEVICE_UUID_RE = /^00000000-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ANY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ANDROID_ID_RE = /^[0-9a-f]{16}$/i
const UUID_GREP = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export function fingerprintFile() {
  return join(dataRoot(), 'data', 'device.json')
}

export function readRememberedFingerprint() {
  const file = fingerprintFile()
  if (!existsSync(file)) return {}
  try {
    const j = JSON.parse(readFileSync(file).toString('utf8').replace(/^\uFEFF/, ''))
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

export function rememberFingerprint(fp = {}) {
  const next = { ...readRememberedFingerprint() }
  for (const k of ['mobileModel', 'mobileDeviceId', 'mobileOsVersion', 'buildId']) {
    if (fp[k] === undefined || fp[k] === null) continue
    const v = String(fp[k]).trim()
    if (v) next[k] = v
  }
  if (!next.mobileDeviceId && !next.mobileModel) return next
  next.saved_at = new Date().toISOString()
  try {
    mkdirSync(dirname(fingerprintFile()), { recursive: true })
    writeFileSync(fingerprintFile(), JSON.stringify(next, null, 2))
  } catch {
  }
  return next
}

export function androidIdToUuid(androidId) {
  const v = String(androidId || '').trim()
  if (!ANDROID_ID_RE.test(v)) return ''
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-0000-000000000000`
}

export function deviceIdCandidates({ session, cands, info, extra } = {}) {
  const out = []
  const seen = new Set()
  const add = (raw, why, { allowZero = false, allowEmpty = false } = {}) => {
    if (raw === undefined || raw === null) return
    const v = String(raw).trim()
    if (!v && !allowEmpty) return
    if (v && !ANY_UUID_RE.test(v) && !ANDROID_ID_RE.test(v)) return
    if (v === ZERO_DEVICE_ID && !allowZero) return
    const key = v.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ value: v, why })
  }
  add(normalizeSession(session || {}).mobileDeviceId, '会话里已有的值', { allowEmpty: true })
  for (const d of cands?.deviceIds ?? []) add(d?.value, 'App 数据里扫到的')
  for (const f of [].concat(extra || [])) {
    add(f && typeof f === 'object' ? f.mobileDeviceId : f, '外部给定')
  }
  add(readRememberedFingerprint().mobileDeviceId, '本机记住的值')
  add('', '空串（老版本 App 形态）', { allowEmpty: true })
  add(androidIdToUuid(info?.androidId), 'android_id 推出的 UUID 形态')
  add(ZERO_DEVICE_ID, '固定 UUID 兜底', { allowZero: true })
  return out
}

const uuidScanCache = new Map()

export async function findAppUuids({ adb, serial, refresh = false } = {}) {
  const cacheKey = String(serial || process.env.LP_ADB_DEVICE || '-')
  const cached = uuidScanCache.get(cacheKey)
  if (!refresh && cached && (cached.rows.length ? Date.now() - cached.at < 300000 : Date.now() - cached.at < 20000)) {
    return cached.rows
  }
  const base = `/data/data/${PKG}`
  const rows = []
  const collect = (text) => {
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i.exec(line)
      if (!m) continue
      const v = m[2].toLowerCase()
      if (v === ZERO_DEVICE_ID) continue
      if (rows.some((x) => x.value === v)) continue
      rows.push({ value: v, hits: Number(m[1]) })
    }
  }
  const cmd = `grep -rhoaE '${UUID_GREP}' ${base} 2>/dev/null | tr 'A-F' 'a-f' | sort | uniq -c | sort -rn | head -10`
  const viaRoot = await shellRoot(cmd, { adb, serial, timeout: 120000 })
  collect(viaRoot.stdout)
  if (!rows.length) {
    const ls = [
      `${base}/app_webview/Local\\ Storage/leveldb/*`,
      `${base}/app_webview/Default/Local\\ Storage/leveldb/*`,
      `${base}/app_webview/*/Local\\ Storage/leveldb/*`,
    ].join(' ')
    const cmd16 = `cat ${ls} 2>/dev/null | tr -d '\\000' | grep -aoiE '${UUID_GREP}' | tr 'A-F' 'a-f' | sort | uniq -c | sort -rn | head -10`
    const via16 = await shellRoot(cmd16, { adb, serial, timeout: 90000 })
    collect(via16.stdout)
  }
  if (!rows.length) {
    const inner = `run-as ${PKG} sh -c "grep -rhoaE '${UUID_GREP}' . 2>/dev/null | tr 'A-F' 'a-f' | sort | uniq -c | sort -rn | head -10"`
    const viaRunAs = await runAdb(serial ? ['-s', String(serial), 'shell', inner] : ['shell', inner], {
      adb,
      encoding: 'utf8',
      timeout: 60000,
    })
    collect(viaRunAs.stdout)
  }
  const sorted = sortByHits(rows)
  uuidScanCache.set(cacheKey, { at: Date.now(), rows: sorted })
  return sorted
}

function sortByHits(rows) {
  return [...rows].sort((a, b) => b.hits - a.hits)
}

function fingerprintVariants(session, extra = []) {
  const cur = normalizeSession(session)
  const given = Array.isArray(extra) ? extra : [extra]
  const cands = [
    { mobileModel: cur.mobileModel, mobileDeviceId: '', mobileOsVersion: cur.mobileOsVersion },
    ...given.filter(Boolean),
  ]
  const seen = new Set()
  return cands
    .map((f) => ({ ...cur, ...f }))
    .filter((f) => {
      const key = `${f.mobileModel}|${f.mobileDeviceId}|${f.mobileOsVersion}`
      const curKey = `${cur.mobileModel}|${cur.mobileDeviceId}|${cur.mobileOsVersion}`
      if (key === curKey || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const absentDeviceId = (v) => v === undefined || v === null || String(v).trim() === ''

export async function verifySession(session, { retryFingerprint = true, fingerprints, deviceIds } = {}) {
  const s0 = normalizeSession(session)
  const miss = missingFingerprint(s0)
  const hard = miss.filter((k) => !k.startsWith('mobileDeviceId'))
  const missingAll = absentDeviceId(s0.mobileDeviceId) || hard.length ? [...hard, 'mobileDeviceId'] : []
  const info4 = `缺少设备指纹：${missingAll.join('、')}。服务端按 (token, uid, 设备指纹) 定位会话，缺失必然 101，请填写后再试。`
  if (hard.length) {
    return { ok: false, status: -4, needFingerprint: true, missing: missingAll, info: info4, session: s0 }
  }

  const plan = []
  const seen = new Set()
  const push = (s, why) => {
    if (!s) return
    const key = `${s.mobileModel}|${s.mobileDeviceId}|${s.mobileOsVersion}`
    if (seen.has(key)) return
    seen.add(key)
    plan.push({ s, why })
  }
  if (!absentDeviceId(s0.mobileDeviceId)) push(s0, '当前')
  if (retryFingerprint) {
    for (const d of deviceIdCandidates({
      session: s0,
      extra: [].concat(fingerprints || [], deviceIds || []),
    })) {
      push({ ...s0, mobileDeviceId: d.value }, d.why)
    }
    for (const v of fingerprintVariants(s0, fingerprints)) push(v, '指纹变体')
  }
  if (!plan.length) push(s0, '当前')

  let last = null
  for (const { s, why } of plan.slice(0, 12)) {
    try {
      const r = await makeClient(s)('User/myZone')
      const status = Number(r.status)
      if (status === 1) {
        const resolved = why !== '当前'
        if (resolved) rememberFingerprint(s)
        return { ok: true, status, info: r.info ?? '', data: r.data, session: s, retried: resolved, via: why }
      }
      if (String(r.info || '').includes('版本过低')) {
        return { ok: false, status: 0, gate: 'version', info: r.info, data: r.data, session: s }
      }
      last = { ok: false, status, info: r.info ?? '', data: r.data, session: s }
    } catch (e) {
      last = { ok: false, status: -1, info: e.message, session: s }
    }
  }

  const out = { ...(last || { ok: false, status: -4, session: s0 }) }
  if (absentDeviceId(s0.mobileDeviceId) && out.status !== 102) {
    out.ok = false
    out.status = -4
    out.needFingerprint = true
    out.missing = ['mobileDeviceId']
    out.info = info4
  }
  return out
}

export async function refreshSession(session) {
  const s = normalizeSession(session)
  if (!s.refresh_token) return { ok: false, status: -3, info: '没有 refresh_token' }
  const { LepaoClient } = await import('../../server/lib/lp-client.mjs')
  const c = new LepaoClient(s)
  try {
    const r = await c.refreshToken()
    const dec = r.dec || {}
    const token = dec.access_token || (c.s.token !== s.token ? c.s.token : '')
    if (Number(r.status) !== 1 || !token || token === s.token) {
      return { ok: false, status: Number(r.status) || -1, info: r.info || '续期未拿到新 token' }
    }
    return {
      ok: true,
      status: 1,
      info: '续期成功',
      token,
      refresh_token: dec.refresh_token || s.refresh_token,
    }
  } catch (e) {
    return { ok: false, status: -1, info: e.message }
  }
}

export async function hydrate(session, meta = {}) {
  const out = { ...session }

  for (const k of ['uid', 'school_id', 'student_num', 'school_name', 'nick_name', 'run_zone_id', 'term_id']) {
    const v = meta?.[k]
    if (v === undefined || v === null || String(v).trim() === '') continue
    out[k] = k === 'uid' || k === 'school_id' ? Number(v) || out[k] : (out[k] === undefined || out[k] === '' || out[k] === 0 ? v : out[k])
  }

  const call = makeClient(normalizeSession(out))

  const fill = (d) => {
    if (!d || typeof d !== 'object') return
    if (!out.uid && d.uid) out.uid = Number(d.uid)
    if (!Number(out.school_id) && d.school_id) out.school_id = Number(d.school_id)
    if (!out.student_num) {
      const n = d.student_num ?? d.number ?? d.num
      if (n && String(n) !== '0') out.student_num = String(n)
    }
    if (!out.school_name) out.school_name = d.school_name ?? out.school_name
    if (!out.nick_name) out.nick_name = d.nick_name ?? d.name ?? out.nick_name
    if (!out.term_id && d.term_id) out.term_id = String(d.term_id)
    if (!out.run_zone_id && d.run_zone_id) out.run_zone_id = String(d.run_zone_id)
  }

  try {
    const u = await call('User/User')
    if (Number(u.status) === 1) fill(u.dec ?? u.data)
  } catch {
  }

  try {
    const idx = await call('WpIndex/index')
    if (Number(idx.status) === 1) fill({ ...(idx.dec ?? idx.data), uid: (idx.dec ?? idx.data)?.uid })
  } catch {
  }

  try {
    const z = await call('User/myZone')
    if (Number(z.status) === 1) fill(z.dec?.user_info)
  } catch {
  }
  return out
}

const log = (msg) => process.env.LOGIN_SYNC_QUIET !== '1' && console.log(msg)

export function orderTokens(tokens = []) {
  const rank = { key: 0, raw: 1, 'raw-lower': 2 }
  return [...tokens].sort((a, b) => {
    const byConf = (rank[a.confidence] ?? 9) - (rank[b.confidence] ?? 9)
    if (byConf !== 0) return byConf
    const ao = a.source === 'logcat' ? -1 : Number(a.offset ?? 0)
    const bo = b.source === 'logcat' ? -1 : Number(b.offset ?? 0)
    return bo - ao
  })
}

export function collectFromDir(dir) {
  const results = []
  const seen = new Set()
  const walk = (d, depth = 0) => {
    if (depth > 6 || seen.size > MAX_FILES * 4) return
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        walk(p, depth + 1)
        continue
      }
      if (SKIP_EXT.test(e.name)) continue
      let size = 0
      try {
        size = statSync(p).size
      } catch {
        continue
      }
      if (size === 0 || size > MAX_DIR_FILE) continue
      if (results.length >= MAX_FILES) return
      try {
        results.push(extractFromBuffer(readFileSync(p), { source: p }))
      } catch {
      }
    }
  }
  walk(dir)
  return results
}

function readMmkvMeta(buf) {
  try {
    const { entries } = parseMmkv(buf)
    if (!entries.length) return null
    const text = (keys) => {
      for (const k of keys) {
        const e = mmkvLast(entries, k)
        if (e && String(e.str).trim() !== '') return String(e.str).trim()
      }
      return undefined
    }
    const number = (keys) => {
      for (const k of keys) {
        const e = mmkvLast(entries, k)
        if (!e) continue
        const n = valueAsNumber(e)
        if (n !== null && Number.isFinite(n) && n > 0) return n
      }
      return undefined
    }
    const meta = {
      uid: number(['user_id', 'uid']),
      school_id: number(['school_id']),
      student_num: text(['student_num', 'user_num', 'role_num']),
      school_name: text(['school_name']),
      nick_name: text(['user_nickname', 'user_name']),
      run_zone_id: number(['run_zone_id']),
      term_id: number(['term_id']),
    }
    return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== ''))
  } catch {
    return null
  }
}

function pickTargets(treeText, base) {
  const files = parseLsTree(treeText, base).filter((f) => {
    if (f.size === 0 || f.size > MAX_FILE) return false
    return !SKIP_EXT.test(f.path)
  })
  const score = (p) => {
    const idx = PRIORITY_DIRS.findIndex((d) => p.includes(`/${d}`))
    return idx < 0 ? PRIORITY_DIRS.length : idx
  }
  return files.sort((a, b) => score(a.path) - score(b.path)).slice(0, MAX_FILES)
}

export async function collectFromDevice({ adb, serial, host } = {}) {
  const out = []
  let meta = {}
  if (host) await connectHost(host, { adb })
  const devs = await listDevices(adb)
  if (!devs.ok) {
    return { ok: false, error: `adb 不可用：${adbErrorHint(devs.error)}`, results: out }
  }
  const wanted = serial || host || process.env.LP_ADB_DEVICE || ''
  const dev = (wanted && devs.devices.find((d) => d.serial === wanted)) ||
    devs.devices.find((d) => d.serial === devs.preferred)
  if (!dev) return { ok: false, error: '没有已连接的设备（adb devices 为空）', results: out, devices: devs.devices }
  if (dev.state !== 'device') {
    return {
      ok: false,
      error: `设备状态 ${dev.state}（需先在手机上点「允许 USB 调试」/ 重新 adb connect）`,
      results: out,
      devices: devs.devices,
    }
  }

  const serial2 = dev.serial
  const base = `/data/data/${PKG}`
  const root = await hasRoot(adb, serial2)
  log(`设备：${serial2}　root：${root ? '有' : '无'}`)

  const info = await deviceInfo({ adb, serial: serial2 })

  const appUuids = await findAppUuids({ adb, serial: serial2 }).catch(() => [])
  if (appUuids.length) {
    log(`设备 UUID 候选 ${appUuids.length} 个：${appUuids.slice(0, 3).map((u) => u.value).join(' / ')}`)
    out.push({
      source: '<uuid-scan>',
      tokens: [],
      refreshes: [],
      uids: [],
      studentNums: [],
      schoolIds: [],
      deviceIds: appUuids.map((u) => ({ value: u.value, key: 'uuid-scan', hits: u.hits })),
    })
  }

  if (root) {
    let targets = []
    const tree = await listTree(base, { adb, serial: serial2, root: true })
    if (tree.ok) {
      const parsed = parseLsTree(tree.text, base)
      targets = pickTargets(tree.text, base)
      log(`目录可读：${parsed.length} 个文件，按优先级取 ${targets.length} 个`)
    } else {
      log(`目录不可读：${tree.error}`)
    }

    const hit = new Set()
    for (const pat of ['[0-9A-Fa-f]{32}', 'token']) {
      const g = await grepFiles(base, pat, { adb, serial: serial2, root: true })
      if (g.ok) for (const f of g.files) hit.add(f)
    }
    const gid = await grepFiles(base, '00000000-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', { adb, serial: serial2, root: true })
    if (gid.ok) for (const f of gid.files) hit.add(f)
    if (hit.size) {
      log(`grep 命中 ${hit.size} 个候选文件，优先读`)
      const mmkv = [...hit].filter((p) => /\/mmkv\//.test(p))
      targets = [
        ...mmkv.map((p) => ({ path: p, size: -1, from: 'grep' })),
        ...[...hit].filter((p) => !mmkv.includes(p)).map((p) => ({ path: p, size: -1, from: 'grep' })),
        ...targets.filter((t) => !hit.has(t.path)),
      ].slice(0, MAX_FILES + 30)
    }

    const realTokens = new Set()
    for (const t of targets) {
      const r = await rootCat(t.path, { adb, serial: serial2 })
      if (!r.ok || r.stdout.length === 0) continue
      const buf = Buffer.from(r.stdout)
      const one = extractFromBuffer(buf, { source: t.path })
      for (const tk of one.tokens ?? []) realTokens.add(tk.value)
      out.push(one)
      if (/\/mmkv\//.test(t.path)) {
        const m = readMmkvMeta(buf)
        if (m) meta = { ...meta, ...m }
      }
    }
    log(`root 通道读到 ${out.length} 个数据块，其中 32 位 token ${realTokens.size} 个`)
    if (Object.keys(meta).length) {
      log(`MMKV 元数据：uid=${meta.uid ?? '-'} school_id=${meta.school_id ?? '-'} student_num=${meta.student_num ?? '-'} zone=${meta.run_zone_id ?? '-'} term=${meta.term_id ?? '-'}`)
    }

    if (realTokens.size > 0) return { ok: true, device: dev, root, info, results: out, meta }
  } else {
    const probe = await runAsCat(`shared_prefs`, { adb, serial: serial2 })
    if (probe.ok && !/not debuggable|Permission denied/i.test(String(probe.stderr))) {
      log('run-as 可用，按 debuggable 包采集')
      const tree = await listTree(base, { adb, serial: serial2, root: false })
      if (tree.ok) {
        for (const t of pickTargets(tree.text, base).slice(0, 20)) {
          const r = await runAsCat(t.path, { adb, serial: serial2 })
          if (r.ok && r.stdout.length) out.push(extractFromBuffer(r.stdout, { source: t.path }))
        }
      }
    }
  }

  for (const ext of EXTERNAL_DIRS) {
    const tree = await listTree(ext, { adb, serial: serial2, root: false })
    if (!tree.ok) continue
    const targets = pickTargets(tree.text, ext).slice(0, 15)
    if (targets.length) log(`外部存储 ${ext}：${targets.length} 个文件`)
    for (const t of targets) {
      const r = await catFile(t.path, { adb, serial: serial2 })
      if (r.ok && r.stdout.length) out.push(extractFromBuffer(r.stdout, { source: t.path }))
    }
  }

  const lc = await dumpLogcat({ adb, serial: serial2 })
  if (lc.ok && lc.stdout.length > 0) {
    out.push(extractFromBuffer(lc.stdout, { source: 'logcat' }))
  }

  return { ok: true, device: dev, root, info, results: out, meta }
}

export function adbErrorHint(err) {
  const e = String(err ?? '')
  if (/ENOENT/.test(e)) {
    const bin = resolveAdb()
    return bin === 'adb'
      ? '找不到 adb：tools/platform-tools 不存在且 PATH 里没有 adb。把 platform-tools 整个目录放到 tools/platform-tools，或设 LP_ADB 指向 adb.exe'
      : `找不到 adb 可执行文件：${bin}（目录被删/移动了？用 LP_ADB 指定新路径，或重跑 node scripts/adb-doctor.mjs 自检）`
  }
  if (/EPERM|EACCES/.test(e)) return `adb 被系统拒绝执行（EACCES/EPERM）：${e}`
  if (/more than one device/i.test(e)) return '同时连着多台设备，请用 --serial 指定'
  if (/no devices\/emulators found|device '.*' not found/i.test(e)) return '没有已连接设备：adb connect host:5555，或插 USB 并在手机上允许调试'
  return e
}

export async function probeDevice({ adb, serial, host } = {}) {
  const lines = []
  const say = (s) => {
    lines.push(s)
    log(s)
  }

  if (host) {
    const c = await connectHost(host, { adb })
    say(`adb connect ${c.target} → ${c.ok ? '已连接' : c.text}`)
  }

  const devs = await listDevices(adb)
  if (!devs.ok) return { ok: false, error: `adb 不可用：${adbErrorHint(devs.error)}`, lines }
  say(`adb 设备 ${devs.devices.length} 台${devs.preferred ? `，本次使用 ${devs.preferred}` : ''}`)
  for (const d of devs.devices) say(`  · ${d.serial} (${d.state})${d.model ? ` model=${d.model}` : ''}`)
  const dev = (serial && devs.devices.find((d) => d.serial === serial)) ||
    devs.devices.find((d) => d.serial === devs.preferred)
  if (!dev) return { ok: false, error: '没有已连接设备', lines }
  say(`选中 ${dev.serial}（${dev.state}）`)
  if (dev.state !== 'device') return { ok: false, error: `设备状态 ${dev.state}，需在手机上允许 USB 调试`, lines }

  const root = await hasRoot(adb, dev.serial)
  say(`root：${root ? '有' : '无'}`)

  const info = await deviceInfo({ adb, serial: dev.serial })
  say(`机型：${info.mobileModel} / Android ${info.mobileOsVersion} / android_id=${info.androidId || '-'}`)

  const base = `/data/data/${PKG}`
  const tree = await listTree(base, { adb, serial: dev.serial, root })
  if (!tree.ok) {
    say(`私有目录不可读：${tree.error}`)
  } else {
    const files = parseLsTree(tree.text, base)
    say(`私有目录文件 ${files.length} 个`)
    const interesting = files.filter((f) => /shared_prefs|mmkv|\.xml$|\.json$/i.test(f.path))
    for (const f of interesting.slice(0, 20)) say(`  ${f.path}  ${f.size}B`)
    if (interesting.length === 0) say('  没有 shared_prefs / mmkv / xml / json，可能全在加密库里')
  }

  for (const ext of EXTERNAL_DIRS) {
    const t = await listTree(ext, { adb, serial: dev.serial, root: false })
    if (t.ok) {
      const files = parseLsTree(t.text, ext).slice(0, 5)
      say(`外部存储 ${ext}：${files.length} 个文件${files.length ? '（' + files[0].path + '）' : ''}`)
    }
  }

  for (const sub of ['files/mmkv', 'shared_prefs', 'databases']) {
    const dir = `${base}/${sub}`
    const r = await shellRoot(`ls -la ${dir}`, { adb, serial: dev.serial, timeout: 15000 })
    if (!r.ok) continue
    const rows = String(r.stdout)
      .split(/\r?\n/)
      .filter((l) => l.startsWith('-'))
      .slice(0, 8)
    if (!rows.length) continue
    say(`\n${sub}/ 最近的文件（看时间，判断登录后有没有写盘）：`)
    for (const row of rows) say('  ' + row.replace(/\s+/g, ' '))
  }

  const app = await currentActivity({ adb, serial: dev.serial })
  say(`前台 Activity：${app || '未检测到'}`)

  const lc = await dumpLogcat({ adb, serial: dev.serial, lines: 2000 })
  if (lc.ok) {
    const r = extractFromBuffer(lc.stdout, { source: 'logcat' })
    say(`logcat 候选 token ${r.tokens.length} 个`)
  }

  return { ok: root || tree.ok, root, info, device: dev.serial, lines }
}

export async function bringAppToFront({ adb, serial } = {}) {
  const s = (await pickDevice({ adb, serial })) || serial
  if (!s) return { ok: false, error: '没有已连接设备' }
  const r = await launchApp({ adb, serial: s })
  return { ok: r.ok, serial: s, info: String(r.stdout || r.stderr).slice(0, 200) }
}

export async function scanAllHex({ adb, serial } = {}) {
  const s = (await pickDevice({ adb, serial })) || serial
  const base = `/data/data/${PKG}`
  const r = await shellRoot(`grep -rHoE '[0-9A-Fa-f]{32}' ${base} 2>/dev/null`, {
    adb,
    serial: s,
    timeout: 120000,
  })
  if (!r.ok) return { ok: false, error: r.error ?? r.stderr, groups: [] }

  const map = new Map()
  for (const line of String(r.stdout).split(/\r?\n/)) {
    const i = line.lastIndexOf(':')
    if (i <= 0) continue
    const path = line.slice(0, i).trim()
    const val = line.slice(i + 1).trim()
    if (!/^[0-9A-Fa-f]{32}$/.test(val)) continue
    if (!map.has(val)) map.set(val, { value: val, files: new Set(), count: 0 })
    const g = map.get(val)
    g.files.add(path)
    g.count++
  }

  const groups = [...map.values()]
    .map((g) => ({
      value: g.value,
      upper: !/[a-f]/.test(g.value),
      count: g.count,
      files: [...g.files],
    }))
    .sort((a, b) => Number(b.upper) - Number(a.upper) || b.count - a.count)

  return { ok: true, groups }
}

export async function readDeviceMeta({ adb, serial } = {}) {
  const s = (await pickDevice({ adb, serial })) || serial || process.env.LP_ADB_DEVICE || ''
  if (!s) return null
  const r = await rootCat(`/data/data/${PKG}/files/mmkv/setting`, { adb, serial: s })
  const buf = r.ok ? Buffer.from(r.stdout || []) : Buffer.alloc(0)
  if (!buf.length) return null
  let entries = []
  try {
    entries = parseMmkv(buf).entries
  } catch {
    return null
  }
  const get = (k) => mmkvLast(entries, k)
  const str = (k) => String(get(k)?.str ?? '').trim()
  return {
    serial: s,
    uid: Number(valueAsNumber(get('user_id'))) || 0,
    token: str('access_token'),
    refresh_token: str('refresh_token'),
    school_id: Number(valueAsNumber(get('school_id'))) || 0,
    student_num: str('user_num'),
    term_id: str('term_id'),
    run_zone_id: str('run_zone_id'),
    nick_name: str('user_nickname'),
    school_name: str('school_name'),
  }
}

export async function loginFromDevice(opts = {}) {
  let userUid = Number(opts.uid) || 0
  const trace = []

  if (!userUid && !opts.candidates && !opts.dir) {
    const meta0 = await readDeviceMeta({ adb: opts.adb, serial: opts.serial }).catch(() => null)
    if (meta0?.uid) {
      userUid = meta0.uid
      trace.push(`uid：${userUid}（设备 MMKV user_id）`)
    }
  }

  if (!userUid) {
    return {
      ok: false,
      needUid: true,
      error: '缺少 uid：当前 App 里没登录过就没有 uid 可扫。请在网页上填 uid，或在手机上先用微信/QQ 登录一次。',
      trace: ['服务端按 (token, uid) 定位会话，uid 猜错一律得到 101，所以这里不猜。'],
    }
  }

  let results = []
  let device = null
  let info = null
  let meta = {}

  if (opts.candidates) {
    results = [opts.candidates]
  } else if (opts.dir) {
    trace.push(`扫描目录 ${opts.dir}`)
    results = collectFromDir(opts.dir)
  } else {
    const r = await collectFromDevice(opts)
    if (!r.ok) return { ok: false, error: r.error, trace, devices: r.devices }
    device = r.device
    info = r.info
    meta = r.meta ?? {}
    trace.push(`设备 ${r.device.serial}（root=${r.root}），命中 ${r.results.length} 个可读数据块`)
    results = r.results
  }

  const cands = mergeCandidates(results)
  const candsOrdered = { ...cands, tokens: orderTokens(cands.tokens) }
  trace.push(`候选 token ${cands.tokens.length} 个、refresh_token ${cands.refreshes.length} 个`)
  trace.push(`uid：${userUid}（手动指定）`)

  const combo = buildCombo(candsOrdered, { uid: userUid })
  if (!combo) {
    return {
      ok: false,
      error: '没有扫到任何 32 位 token 候选。可能 App 加密了本地存储，改用 Frida 通道或抓包 --save。',
      trace,
      cands,
    }
  }

  const schoolId = Number(opts.school_id) || meta.school_id || cands.schoolIds.find((s) => s.value !== 0)?.value || 0
  const studentNum = opts.student_num ? String(opts.student_num) : (meta.student_num ?? cands.studentNums[0]?.value ?? '')

  const latestFirst = candsOrdered.tokens

  const fpGiven = {
    mobileModel: opts.mobileModel != null ? String(opts.mobileModel).trim() : undefined,
    mobileDeviceId: opts.mobileDeviceId != null ? String(opts.mobileDeviceId).trim() : undefined,
    mobileOsVersion: opts.mobileOsVersion != null ? String(opts.mobileOsVersion).trim() : undefined,
  }

  const remembered = readRememberedFingerprint()
  const appDeviceId = (cands.deviceIds ?? [])
    .map((d) => String(d.value))
    .find((v) => ANY_UUID_RE.test(v) || ANDROID_ID_RE.test(v)) || ''
  const firstNonEmpty = (...vals) => {
    for (const v of vals) {
      if (v === undefined || v === null) continue
      const s = String(v).trim()
      if (s) return s
    }
    return undefined
  }

  const session = {
    token: combo.token,
    uid: combo.uid,
    school_id: schoolId,
    student_num: studentNum,
    mobileModel: firstNonEmpty(fpGiven.mobileModel, info?.mobileModel, remembered.mobileModel) ?? '',
    mobileDeviceId: firstNonEmpty(fpGiven.mobileDeviceId, appDeviceId, remembered.mobileDeviceId) ?? '',
    mobileOsVersion: firstNonEmpty(fpGiven.mobileOsVersion, info?.mobileOsVersion, remembered.mobileOsVersion) ?? '',
    ...(firstNonEmpty(info?.buildId, remembered.buildId) ? { buildId: firstNonEmpty(info?.buildId, remembered.buildId) } : {}),
    refresh_token: cands.refreshes[0]?.value || undefined,
    ...(meta.run_zone_id ? { run_zone_id: String(meta.run_zone_id) } : {}),
    ...(meta.term_id ? { term_id: String(meta.term_id) } : {}),
    ...(meta.school_name ? { school_name: meta.school_name } : {}),
    ...(meta.nick_name ? { nick_name: meta.nick_name } : {}),
  }

  trace.push(`取用：token=${combo.token}（${combo.confidence}${combo.key ? '/' + combo.key : ''}）`)
  trace.push(
    `设备指纹：${session.mobileModel || '（缺 mobileModel）'} / ${session.mobileDeviceId ? session.mobileDeviceId : "''（空串，老版本 App 的形态；4.3.3 起应为设备 UUID）"} / ${session.mobileOsVersion || '（缺 mobileOsVersion）'}`,
  )
  if (session.refresh_token) trace.push(`refresh_token=${String(session.refresh_token).slice(0, 8)}…`)

  if (!opts.verify) {
    trace.push('未校验（默认只读设备，不发请求）')
    return { ok: true, session, verified: false, trace, cands, combo, device }
  }

  const altFps = [
    ...(Array.isArray(opts.fingerprints) ? opts.fingerprints : opts.fingerprints ? [opts.fingerprints] : []),
    { mobileDeviceId: '' },
    ...(cands.deviceIds ?? []).slice(0, 3).map((d) => ({ mobileDeviceId: d.value })),
  ]

  const idCandidates = deviceIdCandidates({
    session,
    cands,
    info,
    extra: [fpGiven.mobileDeviceId, remembered.mobileDeviceId, ...(opts.fingerprints ? [].concat(opts.fingerprints) : [])],
  }).map((c) => c.value)

  const attempt = async (sess) => {
    const v = await verifySession(sess, { fingerprints: altFps, deviceIds: idCandidates })
    const fp = v.session
      ? `${v.session.mobileModel}/${v.session.mobileDeviceId || '-'}/a${v.session.mobileOsVersion}`
      : ''
    trace.push(`校验：${v.status} ${v.info || 'ok'}${v.retried ? `（换指纹 ${fp} 后通过）` : ''}`)
    return v
  }

  let v = await attempt(session)
  if (v.ok) {
    const picked = { ...session, ...(v.session ? pickFingerprint(v.session) : {}) }
    rememberFingerprint(picked)
    const full = await hydrate(picked, meta)
    return { ok: true, session: full, verified: true, trace: [...trace, ...(v.retried ? [`指纹已确定：${JSON.stringify(pickFingerprint(v.session))}`] : [])], cands, combo, device }
  }

  if (v.needFingerprint) {
    if (idCandidates.length > 1) {
      trace.push(`已轮试 ${idCandidates.length} 个 mobileDeviceId 候选（含扫到的 UUID 与本机记住的值）都没通过，需要在登录页填 App 真实发出去的那个设备 UUID`)
    }
    return { ok: false, verified: false, status: v.status, needFingerprint: true, missing: v.missing, info: v.info, session: { ...session, mobileDeviceId: v.session?.mobileDeviceId ?? session.mobileDeviceId }, trace, cands, combo, device }
  }

  let refreshedToken = ''
  if ((v.status === 102 || v.status === 101) && opts.refresh !== false && cands.refreshes?.length) {
    const combos = []
    for (const rf of cands.refreshes) {
      const at = cands.tokens.find((t) => t.refresh_of === rf.value || String(t.value).toUpperCase() === String(session.token).toUpperCase())
      combos.push({ refresh: rf.value, access: (at || cands.tokens[0]).value })
    }
    combos.push({ refresh: session.refresh_token, access: session.token })
    const seenRf = new Set()
    trace.push(`refresh 续期：${combos.length} 组候选`)
    for (const c of combos) {
      if (!c.refresh || seenRf.has(c.refresh)) continue
      seenRf.add(c.refresh)
      const rf = await refreshSession({ ...session, token: c.access, refresh_token: c.refresh })
      if (!rf.ok) {
        trace.push(`  续期 ${String(c.refresh).slice(0, 8)}… × ${String(c.access).slice(0, 8)}… → ${rf.status} ${String(rf.info || '').slice(0, 20)}`)
        continue
      }
      refreshedToken = rf.token
      const s2 = { ...session, token: rf.token, refresh_token: rf.refresh_token }
      const v2 = await verifySession(s2, { fingerprints: altFps, deviceIds: idCandidates })
      trace.push(`  续期成功 ${String(c.refresh).slice(0, 8)}… → token=${String(rf.token).slice(0, 8)}… 校验 ${v2.status}`)
      if (v2.ok) {
        const full = await hydrate(s2, meta)
        return { ok: true, session: full, verified: true, trace, cands, combo: { ...combo, token: rf.token }, device, refreshed: true }
      }
    }
  }

  if (v.status === 102 || v.status === 101) {
    const tried = new Set(
      [session.token, refreshedToken].filter(Boolean).map((t) => String(t).toUpperCase()),
    )
    const queue = []
    for (const t of cands.tokens ?? []) {
      const k = String(t.value).toUpperCase()
      if (tried.has(k)) continue
      tried.add(k)
      queue.push(t)
    }
    trace.push(`按序轮试剩余 ${queue.length} 颗候选（含裸串）`)
    for (const t of queue) {
      const s2 = { ...session, token: t.value, mobileDeviceId: v.session?.mobileDeviceId ?? session.mobileDeviceId }
      const v2 = await verifySession(s2, { retryFingerprint: false })
      const mark = v2.ok ? '✓' : '✗'
      trace.push(`  ${mark} ${t.value.slice(0, 8)}…（${t.confidence}${t.key ? '/' + t.key : ''}）：${v2.status} ${String(v2.info ?? '').slice(0, 18)}`)
      if (v2.ok) {
        const full = await hydrate(s2, meta)
        return {
          ok: true,
          session: full,
          verified: true,
          trace,
          cands,
          combo: { ...combo, token: t.value, key: t.key ?? null, confidence: t.confidence },
          device,
        }
      }
    }
    trace.push('全部候选都不可用 —— 手机上那颗有效 token 还没落盘，或已被彻底替换，需要在手机上重新登录一次')
  }
  return { ok: false, verified: true, status: v.status, info: v.info, session, trace, cands, combo, device }
}
