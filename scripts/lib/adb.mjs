import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataRoot, readAsset, runtimeDir } from '../../server/lib/paths.mjs'

export const PKG = 'com.lptiyu.tanke'

const EXE_DIR = dirname(process.execPath)
const IS_EXE = !/^node(\.exe)?$/i.test(basename(process.execPath))

const PROJECT_ROOT = (() => {
  try {
    if (import.meta?.url) return fileURLToPath(new URL('../../', import.meta.url))
  } catch {   }
  return EXE_DIR + '/'
})()

const envg = (k) => (process.env[k] ? String(process.env[k]) : '')

const LP_ADB = (() => {
  const v = envg('LP_ADB')
  if (!v) return ''
  return /[\\/]$/.test(v) ? join(v, 'adb.exe') : v
})()

const EXE_CANDIDATES = IS_EXE
  ? [
      join(EXE_DIR, 'platform-tools/adb.exe'),
      join(EXE_DIR, 'tools/platform-tools/adb.exe'),
      join(EXE_DIR, 'adb.exe'),
      join(EXE_DIR, '..', 'platform-tools/adb.exe'),
    ]
  : []

const WIN = process.platform === 'win32'
const ADB_NAMES = WIN ? ['adb.exe', 'adb'] : ['adb']

function adbOnPath() {
  const dirs = String(process.env.PATH || process.env.Path || '').split(WIN ? ';' : ':').filter(Boolean)
  for (const dir of dirs) {
    for (const name of ADB_NAMES) {
      const full = join(dir, name)
      if (existsSync(full)) return full
    }
  }
  return ''
}

const RUNTIME_ADB = join(runtimeDir(), 'platform-tools', 'adb.exe')

export const DEFAULT_ADB_CANDIDATES = [
  ...new Set(
    [
      LP_ADB,
      ...EXE_CANDIDATES,
      join(PROJECT_ROOT, 'tools/platform-tools/adb.exe'),
      join(PROJECT_ROOT, 'tools/platform-tools/adb'),
      join(PROJECT_ROOT, 'platform-tools/adb.exe'),
      join(PROJECT_ROOT, '..', 'platform-tools/adb.exe'),
      RUNTIME_ADB,
      envg('ANDROID_HOME') && join(envg('ANDROID_HOME'), 'platform-tools/adb.exe'),
      envg('ANDROID_SDK_ROOT') && join(envg('ANDROID_SDK_ROOT'), 'platform-tools/adb.exe'),
      envg('LOCALAPPDATA') && join(envg('LOCALAPPDATA'), 'Android/Sdk/platform-tools/adb.exe'),
      resolve('tools/platform-tools/adb.exe'),
      adbOnPath(),
      'adb',
    ].filter(Boolean),
  ),
]

function materializeAdb () {
  if (existsSync(RUNTIME_ADB)) return RUNTIME_ADB
  const exe = readAsset('platform-tools/adb.exe')
  if (!exe) return ''
  try {
    const dir = dirname(RUNTIME_ADB)
    mkdirSync(dir, { recursive: true })
    writeFileSync(RUNTIME_ADB, exe)
    for (const name of ['AdbWinApi.dll', 'AdbWinUsbApi.dll']) {
      const buf = readAsset('platform-tools/' + name)
      if (buf) writeFileSync(join(dir, name), buf)
    }
    return RUNTIME_ADB
  } catch {
    return ''
  }
}

let cachedAdb = null

export function clearAdbCache() {
  cachedAdb = null
}

export function resolveAdb(explicit) {
  if (explicit) return explicit
  if (cachedAdb) return cachedAdb
  for (const p of DEFAULT_ADB_CANDIDATES) {
    if (p === 'adb') continue
    if (existsSync(p)) {
      cachedAdb = p
      return p
    }
  }
  const made = materializeAdb()
  if (made) {
    cachedAdb = made
    return made
  }
  cachedAdb = 'adb'
  return cachedAdb
}

export function adbInfo(explicit) {
  const bin = resolveAdb(explicit)
  const fromPath = bin === 'adb'
  return {
    bin,
    found: fromPath ? Boolean(adbOnPath()) : existsSync(bin),
    fromPath,
    isExe: IS_EXE,
    exeDir: IS_EXE ? EXE_DIR : null,
    candidates: DEFAULT_ADB_CANDIDATES.filter((p) => p !== 'adb').map((p) => ({ path: p, exists: existsSync(p) })),
  }
}

export function missingAdbText() {
  const where = IS_EXE
    ? `把 platform-tools 整个目录复制到 ${EXE_DIR}\\platform-tools\\（即 lepao.exe 旁边）`
    : '把 platform-tools 整个目录放到仓库根 tools\\platform-tools'
  return `找不到 adb（PATH 里也没有）。${where}，或设置 LP_ADB 指向 adb.exe，然后重启程序。`
}

export function missingAdbDetail() {
  const looked = adbInfo()
    .candidates.map((c) => `${c.exists ? '✓' : '·'} ${c.path}`)
    .join('\n')
  return `${missingAdbText()}\n已查找：\n${looked}`
}

export async function adbSelfCheck(explicit) {
  const bin = resolveAdb(explicit)
  const found = adbInfo(explicit).found
  const v = await runAdb(['version'], { adb: bin, encoding: 'utf8', timeout: 8000 })
  const first = String(v.stdout || v.stderr || '').split(/\r?\n/)[0]
  return {
    bin,
    found,
    ok: v.ok && /Android Debug Bridge/i.test(String(v.stdout)),
    version: first,
    error: v.ok ? null : v.error ?? v.stderr ?? null,
    candidates: DEFAULT_ADB_CANDIDATES.map((p) => ({ path: p, exists: p === 'adb' ? null : existsSync(p) })),
  }
}

function toText(buf, encoding) {
  if (encoding === 'buffer') return Buffer.from(buf ?? '')
  let s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf ?? '')
  s = s.replace(/\uFFFD+/g, '').replace(/\u0000+/g, '')
  return s
}

let envCache = null

// adb 会把 adb.log 写进 TEMP；某些环境（受限账户 / 受管机器）系统 TEMP 不可写，
// daemon 会直接起不来。统一指到数据目录下的 data/tmp，源码与 exe 行为一致。
export function adbEnv() {
  if (envCache) return envCache
  try {
    const dir = join(dataRoot(), 'data', 'tmp')
    mkdirSync(dir, { recursive: true })
    envCache = { ...process.env, TMP: dir, TEMP: dir }
  } catch {
    envCache = process.env
  }
  return envCache
}

export function runAdb(args, { adb, timeout = 20000, encoding = 'buffer' } = {}) {
  const bin = resolveAdb(adb)
  return new Promise((res) => {
    let child
    try {
      child = execFile(
        bin,
        args,
        { timeout, maxBuffer: 64 * 1024 * 1024, encoding: encoding === 'buffer' ? 'buffer' : 'utf8', windowsHide: true, env: adbEnv() },
        (err, stdout, stderr) => {
          const code = err?.code ?? 0
          res({
            ok: !err || code === 0,
            stdout: toText(stdout, encoding),
            stderr: toText(stderr, 'utf8'),
            code: typeof code === 'number' ? code : 0,
            error: err ? err.message : undefined,
          })
        },
      )
    } catch (e) {
      res({ ok: false, stdout: encoding === 'buffer' ? Buffer.alloc(0) : '', stderr: '', code: -1, error: e.message })
    }
    child?.on?.('error', () => {})
  })
}

function pre(serial, args) {
  return serial ? ['-s', String(serial), ...args] : args
}

export function parseDevices(out) {
  return String(out ?? '')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^List of devices/i.test(l) && !l.startsWith('*'))
    .map((l) => {
      const parts = l.split(/\s+/)
      const serial = parts.shift() ?? ''
      const state = parts.shift() ?? ''
      const meta = {}
      for (const p of parts) {
        const i = p.indexOf(':')
        if (i > 0) meta[p.slice(0, i)] = p.slice(i + 1).replace(/[^\w.-]/g, '')
      }
      return { serial: serial.replace(/[^\w.:\-\[\]]/g, ''), state, ...meta, tcp: /:\d+$/.test(serial) }
    })
    .filter((d) => d.serial && d.state)
}

export async function listDevices(adb) {
  const r = await runAdb(['devices', '-l'], { adb, encoding: 'utf8' })
  if (!r.ok) return { ok: false, error: r.error ?? r.stderr, devices: [], preferred: null }
  const devices = parseDevices(r.stdout)
  const alive = devices.filter((d) => d.state === 'device')
  const envSerial = process.env.LP_ADB_DEVICE || ''
  const preferred =
    (envSerial && alive.find((d) => d.serial === envSerial)) ||
    alive.find((d) => d.tcp) ||
    alive[0] ||
    null
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  return { ok: true, devices, preferred: preferred ? preferred.serial : null }
}

export async function pickDevice({ adb, serial } = {}) {
  const b = serial || process.env.LP_ADB_DEVICE || ''
  if (b) {
    const one = await runAdb(pre(serial ? b : undefined, ['shell', 'echo', 'ok']), { adb, encoding: 'utf8', timeout: 8000 })
    if (/ok/.test(String(one.stdout))) return b
  }
  const l = await listDevices(adb)
  if (!l.ok) return null
  return l.preferred
}

export async function connectHost(host, { adb, port = 5555, timeout = 10000 } = {}) {
  const target = /:\d+$/.test(String(host)) ? String(host) : `${host}:${port}`
  const r = await runAdb(['connect', target], { adb, encoding: 'utf8', timeout })
  const text = `${r.stdout} ${r.stderr}`
  const ok = /connected to|already connected/i.test(text) && !/failed to connect|unable to connect|Connection refused/i.test(text)
  return { ok, target, text: text.trim().slice(0, 200) }
}

export async function ensureDevice({ adb, serial, host } = {}) {
  if (host) await connectHost(host, { adb })
  const s = await pickDevice({ adb, serial: serial || host })
  return s
}

const suCache = new Map()

export async function hasSu({ adb, serial } = {}) {
  const key = serial || '-'
  if (suCache.has(key)) return suCache.get(key)
  const r = await runAdb(pre(serial, ['shell', 'command -v su || which su || ls /system/bin/su /system/xbin/su 2>/dev/null']), {
    adb,
    encoding: 'utf8',
    timeout: 8000,
  })
  const v = /\/su$|\/su\s/m.test(String(r.stdout))
  suCache.set(key, v)
  return v
}

export async function hasRoot(adb, serial) {
  const id = await runAdb(pre(serial, ['shell', 'id']), { adb, encoding: 'utf8', timeout: 8000 })
  if (/uid=0/.test(String(id.stdout))) return true
  if (!(await hasSu({ adb, serial }))) return false
  const r = await runAdb(pre(serial, ['shell', "su -c 'id'"]), { adb, encoding: 'utf8', timeout: 8000 })
  return /uid=0/.test(String(r.stdout))
}

async function needsSu({ adb, serial } = {}) {
  const r = await runAdb(pre(serial, ['shell', 'id']), { adb, encoding: 'utf8', timeout: 8000 })
  if (/uid=0/.test(String(r.stdout))) return false
  return hasSu({ adb, serial })
}

export async function shellRoot(cmd, { adb, serial, timeout = 20000, encoding = 'utf8' } = {}) {
  const useSu = await needsSu({ adb, serial })
  const inner = useSu ? `su -c '${String(cmd).replace(/'/g, "'\\''")}'` : String(cmd)
  return runAdb(pre(serial, ['shell', inner]), { adb, encoding, timeout })
}

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`

export async function rootCat(path, { adb, serial } = {}) {
  const useSu = await needsSu({ adb, serial })
  const cmd = useSu ? `su -c "cat ${shq(path)}"` : `cat ${shq(path)}`
  return runAdb(pre(serial, ['exec-out', cmd]), { adb, timeout: 15000 })
}

export async function catFile(path, { adb, serial } = {}) {
  return runAdb(pre(serial, ['exec-out', `cat ${shq(path)}`]), { adb, timeout: 15000 })
}

const RUN_AS_FAIL = /not debuggable|Permission denied|inaccessible or not found|not found|No such file/i
export async function runAsCat(path, { adb, serial } = {}) {
  return withOutputFailure(
    await runAdb(pre(serial, ['exec-out', `run-as ${PKG} cat ${path}`]), { adb, timeout: 15000 }),
    RUN_AS_FAIL,
  )
}

export function withOutputFailure(r, pattern) {
  if (!r || !r.ok) return r
  const text = Buffer.isBuffer(r.stdout) ? r.stdout.toString('utf8') : String(r.stdout ?? '')
  if (!pattern.test(text) || text.trim().split('\n').length > 2) return r
  return { ...r, ok: false, stdout: Buffer.isBuffer(r.stdout) ? Buffer.alloc(0) : '', error: text.trim() }
}

export async function listTree(dir, { adb, serial, root = true } = {}) {
  const r = await shellRoot(`ls -laR ${dir}`, { adb, serial, root, timeout: 25000 })
  if (!r.ok) return { ok: false, error: r.error ?? r.stderr, text: '' }
  const text = String(r.stdout)
  if (/Permission denied|No such file|inaccessible/.test(text) && text.trim().split('\n').length <= 2) {
    return { ok: false, error: text.trim(), text }
  }
  return { ok: true, text }
}

export function parseLsTree(text, rootDir) {
  const files = []
  let cur = rootDir
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (line.endsWith(':') && line.includes('/')) {
      cur = line.slice(0, -1).trim()
      continue
    }
    const parts = line.trim().split(/\s+/)
    if (parts.length < 8) continue
    if (parts[0][0] !== '-') continue
    if (!/^[rwxsStT-]{9}$/.test(parts[0].slice(1))) continue
    const size = Number(parts[4])
    if (!Number.isFinite(size) || String(size) !== parts[4]) continue
    const name = parts.slice(7).join(' ')
    if (name === '.' || name === '..') continue
    files.push({ path: `${cur.replace(/\/+$/, '')}/${name}`, size })
  }
  return files
}

export async function grepFiles(dir, pattern, { adb, serial, root = true, timeout = 30000 } = {}) {
  const inner = `grep -rlE '${pattern}' ${dir} 2>/dev/null`
  const r = await shellRoot(inner, { adb, serial, root, timeout })
  if (!r.ok) return { ok: false, error: r.error ?? r.stderr, files: [] }
  const out = String(r.stdout)
  if (/grep: .*(invalid option|unknown option|not found)/i.test(out + String(r.stderr ?? ''))) {
    return { ok: false, error: '设备上的 grep 不支持该参数', files: [] }
  }
  const files = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith('/'))
  return { ok: true, files }
}

export async function launchApp({ adb, serial } = {}) {
  return runAdb(pre(serial, ['shell', `monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`]), {
    adb,
    encoding: 'utf8',
    timeout: 15000,
  })
}

export async function forceStopApp({ adb, serial } = {}) {
  return runAdb(pre(serial, ['shell', `am force-stop ${PKG}`]), { adb, encoding: 'utf8', timeout: 12000 })
}

export async function currentActivity({ adb, serial } = {}) {
  const r = await runAdb(pre(serial, ['shell', 'dumpsys activity activities']), { adb, encoding: 'utf8', timeout: 15000 })
  if (!r.ok) return null
  const m = String(r.stdout).match(/(?:mResumedActivity|topResumedActivity).*?([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/)
  return m?.[1] ?? null
}

export async function dumpLogcat({ adb, serial, lines = 4000 } = {}) {
  return runAdb(pre(serial, ['logcat', '-d', '-t', String(lines)]), { adb, timeout: 25000 })
}

export function streamLogcat({ adb, serial, onChunk } = {}) {
  const bin = resolveAdb(adb)
  const child = execFile(bin, pre(serial, ['logcat', '-v', 'brief']), { maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: adbEnv() })
  const handler = (d) => onChunk?.(String(d))
  child.stdout?.on('data', handler)
  child.stderr?.on('data', handler)
  return () => {
    try {
      child.kill()
    } catch {
    }
  }
}

export async function deviceInfo({ adb, serial } = {}) {
  const r = await runAdb(
    pre(serial, [
      'shell',
      "getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.id; settings get secure android_id",
    ]),
    { adb, encoding: 'utf8', timeout: 10000 },
  )
  const [model = '', os = '', buildId = '', androidId = ''] = String(r.stdout)
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/[^\w.\-]/g, ''))
  return { mobileModel: model, mobileOsVersion: os, buildId, androidId }
}
