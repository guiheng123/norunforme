import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { codeRoot, dataRoot, materializeAsset, runtimeDir } from './paths.mjs'
import { resolveAdb, clearAdbCache, adbInfo, missingAdbText, missingAdbDetail, adbEnv } from '../../scripts/lib/adb.mjs'

const ROOT = codeRoot()
const DATA = dataRoot()
let ADB = resolveAdb()
const TMP = path.join(DATA, 'data', 'device')
const ADB_DEVICE = process.env.LP_ADB_DEVICE || ''
const PY = process.env.LP_PYTHON || ''
export const PKG = 'com.lptiyu.tanke'

export const runs = new Map()

// 设备注入需要的随包文件
export const COMPANIONS = [
  ['runner', 'analysis/frida/runner.py'],
  ['agent', 'analysis/frida/amap3.js'],
  ['feed', 'analysis/feed.sh'],
]

export function companionPath (rel) {
  const local = path.join(ROOT, rel)
  if (fs.existsSync(local)) return local
  return materializeAsset(rel, runtimeDir()) || local
}

export function companionStatus () {
  return Object.fromEntries(COMPANIONS.map(([k, rel]) => [k, fs.existsSync(companionPath(rel))]))
}

export function adbInfoNow () {
  return { ...adbInfo(), resolved: ADB }
}

export function adbHint () {
  return missingAdbDetail()
}

function adbExec (bin, args, timeout, serial) {
  const s = serial ?? cachedSerial
  return new Promise((resolve) => {
    execFile(bin, s ? ['-s', s, ...args] : args, { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: adbEnv() }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        missing: err?.code === 'ENOENT',
        out: String(stdout || '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim(),
        err: String(stderr || err?.message || '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim(),
      })
    })
  })
}

async function adb (args, timeout = 12000, serial) {
  const r = await adbExec(ADB, args, timeout, serial)
  if (!r.missing) return r
  clearAdbCache()
  ADB = resolveAdb()
  const again = await adbExec(ADB, args, timeout, serial)
  if (!again.missing) return again
  return { ok: false, missing: true, out: '', err: missingAdbText() }
}

let cachedSerial = ADB_DEVICE
let serialAt = 0

export function parseDeviceList (out) {
  return String(out || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^List of devices/i.test(l) && !l.startsWith('*'))
    .map((l) => {
      const parts = l.split(/\s+/)
      const serial = parts.shift() || ''
      const state = parts.shift() || ''
      const meta = {}
      for (const p of parts) {
        const i = p.indexOf(':')
        if (i > 0) meta[p.slice(0, i)] = p.slice(i + 1)
      }
      return { serial, state, ...meta, tcp: /:\d+$/.test(serial) }
    })
    .filter((d) => d.serial && d.state)
}

export async function devices () {
  const r = await adb(['devices', '-l'], 12000, '')
  if (!r.ok) return { ok: false, error: r.err, list: [], serial: null }
  const list = parseDeviceList(r.out)
  const alive = list.filter((d) => d.state === 'device')
  if (!cachedSerial || Date.now() - serialAt > 10000) {
    cachedSerial = alive.find((d) => d.serial === ADB_DEVICE)?.serial || alive.find((d) => d.tcp)?.serial || alive[0]?.serial || ''
    serialAt = Date.now()
  }
  if (cachedSerial && !alive.some((d) => d.serial === cachedSerial)) cachedSerial = ''
  return { ok: true, list, serial: cachedSerial || null }
}

export async function serial () {
  if (cachedSerial) return cachedSerial
  const d = await devices()
  return d.serial
}

export async function connect (host) {
  if (!host) return { ok: false, error: '缺少 host，例如 192.168.1.100:5555' }
  const target = /:\d+$/.test(String(host)) ? String(host) : `${host}:5555`
  const r = await adb(['connect', target], 12000, '')
  const text = `${r.out} ${r.err}`
  const ok = /connected to|already connected/i.test(text)
  if (ok) {
    cachedSerial = ''
    serialAt = 0
    await devices()
  }
  return { ok, target, text: text.trim().slice(0, 240), serial: cachedSerial || null, missing: Boolean(r.missing) }
}

async function probeBridge (port = Number(process.env.LP_BRIDGE_PORT || 8790)) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
    const j = await r.json()
    return { up: true, port, device: j.device ?? null, root: !!j.root, hasSession: !!j.hasSession }
  } catch {
    return { up: false, port }
  }
}

export async function status (rules = {}) {
  const d = await devices()
  const s = d.serial
  let foreground = null
  let appPid = null
  const now = Math.floor(Date.now() / 1000)
  if (s) {
    const r = await adb(['shell', 'dumpsys activity activities'], 15000, s)
    const m = /(?:mResumedActivity|topResumedActivity)[^\n]*?([\w.]+\/[\w.$]+)/.exec(r.out)
    if (m) foreground = m[1]
    const ps = await adb(['shell', 'ps -A -o PID,NAME'], 12000, s)
    const pm = /(\d+)\s+com\.lptiyu\.tanke\b/.exec(ps.out)
    if (pm) appPid = Number(pm[1])
  }

  const windowRaw = rules?.runStartTime !== undefined && rules?.runEndTime !== undefined
    ? [fmt(rules.runStartTime), fmt(rules.runEndTime)]
    : null
  const fr = s ? await probeFrida() : { ready: false, reason: '没有 adb 设备', server: false, port: false, appPid: null }
  const bridge = await probeBridge()
  return {
    adb: Boolean(s),
    adbDetail: adbInfoNow(),
    adbError: d.error ?? null,
    serial: s,
    devices: d.list,
    frida: fr.ready,
    fridaDetail: { ...fr, appPid: fr.appPid ?? appPid },
    analysis: companionStatus(),
    appForeground: foreground,
    appPid,
    windowOpen: null,
    now: now * 1000,
    runWindow: windowRaw,
    bridge,
  }
}

const FRIDA_PORT = 27042
let fridaCache = { at: 0, value: null }

export async function probeFrida (force = false) {
  if (!force && fridaCache.value && Date.now() - fridaCache.at < 3000) return fridaCache.value
  const value = await probeFridaUncached()
  fridaCache = { at: Date.now(), value }
  return value
}

async function probeFridaUncached () {
  const s = await serial()
  if (!s) return { ready: false, reason: '没有 adb 设备', server: false, port: false, appPid: null }

  const ps = await adb(['shell', 'ps -A -o PID,NAME 2>/dev/null | grep -w -e f16 -e frida-server'], 15000, s)
  const server = ps.out.trim().length > 0
  const pidMatch = /^\s*(\d+)\s+(f16|frida-server)/m.exec(ps.out)

  let port = false
  if (server) {
    const ns = await adb(['shell', `netstat -tln 2>/dev/null | grep ${FRIDA_PORT}`], 15000, s)
    port = new RegExp(`:${FRIDA_PORT}`).test(ns.out)
  }

  let client = false
  let reason = ''
  if (server && port) {
    const fwd = await adb(['forward', `tcp:${FRIDA_PORT}`, `tcp:${FRIDA_PORT}`], 12000, s)
    if (!fwd.ok && !/already/.test(fwd.err)) reason = 'adb forward 失败：' + fwd.err.slice(0, 60)
    const probe = await fridaProbe()
    client = probe.ok
    if (!client) reason = probe.err
  } else if (!server) {
    reason = '设备上没有运行 frida-server'
  } else {
    reason = `frida-server 未监听 ${FRIDA_PORT} 端口`
  }

  const app = await adb(['shell', 'ps -A -o PID,NAME | grep -w com.lptiyu.tanke'], 12000, s)
  const appPid = (/^(\d+)\s+com\.lptiyu\.tanke/m.exec(app.out) || [])[1]

  return {
    ready: Boolean(server && port && client),
    reason: client ? 'ok' : reason,
    server,
    port,
    client,
    serverPid: pidMatch ? Number(pidMatch[1]) : null,
    appPid: appPid ? Number(appPid) : null,
    serial: s,
  }
}

function fridaProbe () {
  return new Promise((resolve) => {
    const py = PY || 'python'
    const code = 'import frida,sys\ntry:\n d=frida.get_remote_device();\n ps=[p.name for p in d.enumerate_processes()];\n print("OK",len(ps))\nexcept Exception as e:\n print("ERR",type(e).__name__,str(e)[:120])'
    execFile(py, ['-c', code], { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      const out = String(stdout || '') + String(stderr || '')
      if (/^OK\b/m.test(out) || /OK \d+/.test(out)) return resolve({ ok: true })
      resolve({ ok: false, err: (out.trim() || (err && err.message) || 'python/frida 不可用').slice(0, 160) })
    })
  })
}

export async function startFrida () {
  const s = await serial()
  if (!s) throw new Error('没有可用的 adb 设备')

  const who = await adb(['shell', 'id'], 10000, s)
  if (!/uid=0/.test(who.out)) {
    const root = await adb(['root'], 15000, s)
    if (!/restarting|already/.test(root.out + root.err)) {
      throw new Error('adb root 失败：' + (root.err || root.out).slice(0, 80))
    }
    await new Promise((r) => setTimeout(r, 1500))
    cachedSerial = ''
    serialAt = 0
    await serial()
  }

  const bin = await adb(['shell', 'ls -l /data/local/tmp/f16 /data/local/tmp/frida-server 2>/dev/null'], 12000, s)
  const fx = /\/data\/local\/tmp\/f16/.test(bin.out)
    ? '/data/local/tmp/f16'
    : (/\/data\/local\/tmp\/frida-server/.test(bin.out) ? '/data/local/tmp/frida-server' : null)
  if (!fx) throw new Error('设备上没有 frida-server 二进制（期望 /data/local/tmp/f16）')

  await adb(['shell', 'killall -9 f16 2>/dev/null; killall -9 frida-server 2>/dev/null'], 12000, s)
  await adb(['shell', `chmod 755 ${fx}`], 12000, s)

  const app = await adb(['shell', 'ps -A -o PID,NAME | grep -w com.lptiyu.tanke'], 12000, s)
  if (!app.out.trim()) {
    await adb(['shell', `monkey -p ${PKG} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`], 15000, s)
    await new Promise((r) => setTimeout(r, 8000))
  }

  for (let i = 0; i < 10; i++) {
    const ns = await adb(['shell', `netstat -tln 2>/dev/null | grep ${FRIDA_PORT}`], 12000, s)
    if (!new RegExp(`:${FRIDA_PORT}`).test(ns.out)) break
    await adb(['shell', 'killall -9 f16 2>/dev/null; killall -9 frida-server 2>/dev/null'], 12000, s)
    await new Promise((r) => setTimeout(r, 500))
  }
  await adb(['shell', `nohup ${fx} -l 0.0.0.0:${FRIDA_PORT} >/data/local/tmp/frida-start.log 2>&1 &`], 12000, s)
  await new Promise((r) => setTimeout(r, 2500))
  await adb(['forward', `tcp:${FRIDA_PORT}`, `tcp:${FRIDA_PORT}`], 12000, s)

  const st = await probeFrida(true)
  return st
}

export async function stopFrida () {
  const s = await serial()
  if (!s) return { ready: false }
  await adb(['shell', 'killall -9 f16 2>/dev/null; killall -9 frida-server 2>/dev/null'], 12000, s)
  await adb(['forward', '--remove', `tcp:${FRIDA_PORT}`], 12000, s)
  return probeFrida(true)
}

const fmt = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`

export async function startRun (points, startAt) {
  const s = await serial()
  if (!s) throw new Error('没有可用的 adb 设备')
  fs.mkdirSync(TMP, { recursive: true })
  const id = 'dev_' + Math.random().toString(36).slice(2, 8)
  const pts = (points || []).filter((p) => Number.isFinite(Number(p.a)) && Number.isFinite(Number(p.o)))
  if (pts.length < 2) throw new Error('轨迹点不足，先在模拟页生成轨迹')

  const jsonPath = path.join(TMP, `${id}.json`)
  fs.writeFileSync(jsonPath, JSON.stringify(pts.map((p) => ({ a: Number(p.a), o: Number(p.o), s: Number(p.s ?? 3) }))))

  const job = {
    id,
    state: 'running',
    mode: 'idle',
    total: pts.length,
    injected: 0,
    startedAt: Date.now(),
    log: [`track ${pts.length} pts`, `device ${s}`],
    proc: null,
  }
  runs.set(id, job)

  const fr = await probeFrida(true)
  if (fr.ready && fr.appPid) {
    const py = PY || 'python'
    const runner = companionPath('analysis/frida/runner.py')
    const agent = companionPath('analysis/frida/amap3.js')
    const logFile = path.join(TMP, `${id}.log`)
    if (!fs.existsSync(runner) || !fs.existsSync(agent)) {
      throw new Error('缺少 frida agent 脚本（analysis/frida/runner.py / amap3.js）')
    }
    const out = fs.openSync(logFile, 'a')
    const proc = spawn(py, [runner, String(fr.appPid), agent, jsonPath, '3600', logFile], {
      cwd: ROOT, windowsHide: true, stdio: ['ignore', out, out],
    })
    proc.on('exit', (code) => {
      job.log.push(`runner exited code=${code}`)
      if (job.state === 'running') job.state = 'done'
    })
    job.proc = proc
    job.mode = 'frida'
    job.logFile = logFile
    job.log.push(`frida attach pid=${fr.appPid}`)
  } else {
    const list = pts.map((p) => `${Number(p.a).toFixed(6)},${Number(p.o).toFixed(6)}`).join('\n') + '\n'
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    const local = path.join(TMP, `${id}.txt`)
    fs.writeFileSync(local, list)
    await adb(['push', local, '/data/local/tmp/track.txt'], 20000, s)
    const feed = companionPath('analysis/feed.sh')
    if (fs.existsSync(feed)) await adb(['push', feed, '/data/local/tmp/feed.sh'], 20000, s)
    await adb(['shell', 'chmod 755 /data/local/tmp/feed.sh; nohup sh /data/local/tmp/feed.sh /data/local/tmp/track.txt 1 >/dev/null 2>&1 &'], 15000, s)
    job.mode = 'provider'
    job.log.push(`frida 不可用（${fr.reason}），降级为系统定位 provider；此模式不足以让 App 判定为有效跑步`)
  }

  const iv = setInterval(() => {
    job.injected = Math.min(job.total, Math.round((Date.now() - job.startedAt) / 1800))
    if (job.mode === 'frida' && job.logFile && fs.existsSync(job.logFile)) {
      try {
        job.lastLines = fs.readFileSync(job.logFile, 'utf8').trim().split('\n').slice(-3)
      } catch {   }
    }
    if (job.injected >= job.total || job.state !== 'running') clearInterval(iv)
  }, 2000)
  job.timer = iv
  return id
}

export function pollRun (id) {
  const job = runs.get(id)
  if (!job) return null
  const elapsedSec = Math.round((Date.now() - job.startedAt) / 1000)
  return {
    id: job.id,
    state: job.state,
    mode: job.mode,
    injected: job.injected,
    total: job.total,
    distanceKm: +((job.injected * 5.4) / 1000).toFixed(2),
    elapsedSec,
    log: [...job.log, ...(job.lastLines || [])].slice(-20),
  }
}

export async function stopRun (id) {
  const job = runs.get(id)
  if (!job) return false
  job.state = 'stopped'
  try { clearInterval(job.timer) } catch {   }
  if (job.proc) {
    try { job.proc.kill() } catch {   }
    job.log.push('frida runner killed')
  }
  await adb(['shell', 'pkill -f feed.sh 2>/dev/null; true'], 12000)
  job.log.push('stopped')
  return true
}
