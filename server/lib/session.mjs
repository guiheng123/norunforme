import fs from 'node:fs'
import path from 'node:path'
import { dataRoot } from './paths.mjs'

const DATA_DIR = path.join(dataRoot(), 'data')
const FILE = path.join(DATA_DIR, 'session.json')

const EMPTY = {
  mobileModel: '',
  mobileDeviceId: undefined,
  mobileOsVersion: '',
}

const META = new Set(['saved_at', 'lp54', 'lpd3', 'refresh_token'])

const FINGERPRINT_KEYS = new Set(['mobileModel', 'mobileDeviceId', 'mobileOsVersion', 'buildId'])

const DROP = new Set(['version', 'version_name'])

let cache = null

function readJson (file) {
  const raw = fs.readFileSync(file)
  const text = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
    ? raw.subarray(3).toString('utf8')
    : raw.toString('utf8')
  return JSON.parse(text.replace(/^\uFEFF/, ''))
}

export function load () {
  if (cache) return cache
  let disk = {}
  try {
    disk = readJson(FILE)
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  } catch {
    disk = {}
  }
  const clean = {}
  for (const [k, v] of Object.entries(disk)) {
    if (DROP.has(k)) continue
    if (META.has(k)) {
      clean[k] = v
      continue
    }
    if (v === null || v === undefined) continue
    if (typeof v === 'string' && v.trim() === '' && !FINGERPRINT_KEYS.has(k)) continue
    clean[k] = typeof v === 'string' ? v.trim() : v
  }
  cache = { ...EMPTY, ...clean }
  return cache
}

export function save (patch) {
  const base = load()
  const merged = { ...base }
  for (const [k, v] of Object.entries(patch || {})) {
    if (DROP.has(k)) continue
    if (v === undefined) continue
    if (typeof v === 'string' && v.trim() === '' && !META.has(k) && !FINGERPRINT_KEYS.has(k)) continue
    merged[k] = typeof v === 'string' ? v.trim() : v
  }
  cache = { ...merged, saved_at: new Date().toISOString() }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2))
  return cache
}

function removeSessionFile () {
  try {
    fs.rmSync(FILE, { force: true, maxRetries: 6, retryDelay: 80 })
    return { removed: true, blanked: false }
  } catch (e) {
    if (e?.code === 'ENOENT') return { removed: true, blanked: false }
    console.error(`[session] 删除 ${FILE} 失败：${e?.code || e?.message}，改为清空内容`)
    try {
      fs.writeFileSync(FILE, '{}')
      return { removed: false, blanked: true }
    } catch (e2) {
      console.error(`[session] 清空 ${FILE} 也失败：${e2?.code || e2?.message}`)
      return { removed: false, blanked: false }
    }
  }
}

export function clear () {
  cache = { ...EMPTY }
  const file = removeSessionFile()
  try {
    for (const name of fs.readdirSync(DATA_DIR)) {
      if (!name.startsWith('session.json')) continue
      if (name === 'session.json') continue
      try {
        fs.rmSync(path.join(DATA_DIR, name), { force: true, maxRetries: 4, retryDelay: 60 })
      } catch {   }
    }
  } catch {   }
  return { session: cache, removed: file.removed, blanked: file.blanked }
}

export function invalidate () {
  cache = null
}

export function isLoggedIn () {
  const s = load()
  return Boolean(s.token && s.uid)
}

export function hasFingerprint (s = load()) {
  return Boolean(
    String(s.mobileModel || '').trim() &&
      String(s.mobileOsVersion || '').trim() &&
      String(s.mobileDeviceId ?? '').trim(),
  )
}

export function missingFingerprint (s = load()) {
  const miss = []
  if (!String(s.mobileModel || '').trim()) miss.push('mobileModel')
  if (!String(s.mobileOsVersion || '').trim()) miss.push('mobileOsVersion')
  if (!String(s.mobileDeviceId ?? '').trim()) miss.push('mobileDeviceId（4.3.3 起必须是设备 UUID，空串会得到 0 系统错误）')
  return miss
}
