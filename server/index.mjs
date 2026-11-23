#!/usr/bin/env node
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { LepaoClient, decryptResponse } from './lib/lp-client.mjs'
import * as store from './lib/session.mjs'
import { codeRoot, dataRoot, readAsset, IS_SEA } from './lib/paths.mjs'
import { SIG_SHORT, SIG_TOKEN, SIG_REPO, injectAsset, encodeMarks, hasMarks, SIG_DIGEST } from './lib/attest.mjs'
import { SEAL_DIGEST, SEAL_TOKEN, sealMatches } from './lib/attest-seal.mjs'
import { analyzeStats, diagnose, verdictOf, meters } from './lib/sim.mjs'
import { clockOf, planTiming, resolveStart } from './lib/timing.mjs'
import { simulateAlong, weaveCheckpoints } from './lib/pathsim.mjs'
import { buildRunTrack } from './lib/runtrack.mjs'
import { createJob, jobs } from './lib/submit.mjs'
import * as device from './lib/device.mjs'
import { resolveRunZone, isVersionGate } from './lib/zone.mjs'
import { loginFromDevice, verifySession, hydrate, deviceIdCandidates, findAppUuids } from '../scripts/lib/auth.mjs'
import { deviceInfo } from '../scripts/lib/adb.mjs'

const ROOT = codeRoot()
const DIST = path.join(ROOT, 'web', 'dist')
const DIST_KEY = 'web/dist'
const VERSION = '1.0.0'
const ADB_DEVICE = process.env.LP_ADB_DEVICE || ''

// ── 运行期标识 ──────────────────────────────────────────────────────
const SIG_OK = sealMatches(SIG_DIGEST) && SEAL_TOKEN === SIG_TOKEN
const TAG = encodeMarks('sig/1|' + SIG_SHORT)
const ASSET_CACHE = new Map()

const args = process.argv.slice(2)
const argv = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const PORT = Number(argv('port', process.env.LP_PORT || 8787))
const HOST = argv('host', process.env.LP_HOST || '127.0.0.1')

const ok = (res, data, code = 200) => json(res, { ok: true, data }, code)
const fail = (res, code, message, hint, status = 200) => json(res, { ok: false, error: { code, message, hint } }, status)
const CORS_ORIGINS = (process.env.LP_CORS || '').split(',').map((x) => x.trim()).filter(Boolean)

function applyCors (req, res) {
  if (!CORS_ORIGINS.length) return
  const origin = req.headers.origin
  if (!origin) return
  if (!CORS_ORIGINS.includes('*') && !CORS_ORIGINS.includes(origin)) return
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGINS.includes('*') ? '*' : origin)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Vary', 'Origin')
}

function json (res, body, status = 200) {
  const payload = body && typeof body === 'object' && !Array.isArray(body)
    ? { ...body, _tag: TAG }
    : body
  const buf = Buffer.from(JSON.stringify(payload))
  res.setHeader('X-Trace', SIG_TOKEN)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' })
  res.end(buf)
}
function readBody (req) {
  return new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => { b += c; if (b.length > 8e6) req.destroy() })
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}) } catch { resolve({}) } })
  })
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

function assetStamp (rel) {
  if (IS_SEA) return 'sea'
  try {
    const s = fs.statSync(path.join(dataRoot(), rel))
    return `${Math.round(s.mtimeMs)}:${s.size}`
  } catch {
    return 'na'
  }
}

function serveStatic (req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname
  p = decodeURIComponent(p.split('?')[0].split('#')[0])
  if (p.includes('..')) return fail(res, 'BAD_PATH', '非法路径', null, 400)

  const rel = DIST_KEY + p
  let buf = readAsset(rel)
  let ext = path.extname(p)

  if (!buf) {
    buf = readAsset(DIST_KEY + '/index.html')
    ext = '.html'
  }
  if (!buf) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(
      IS_SEA
        ? '<h1>前端资源缺失</h1><p>exe 未内嵌 web/dist，请重新构建。</p>'
        : '<h1>web/dist 未构建</h1><p>先在 web/ 目录执行 <code>npm run build</code>，或用 vite dev 启动前端。</p>',
    )
  }
  if (ext === '.html' || ext === '.js' || ext === '.css') {
    // 缓存跟着文件时间戳走：重新构建后立刻失效，避免继续发旧包
    const key = rel + '|' + assetStamp(rel)
    let cached = ASSET_CACHE.get(key)
    if (!cached) {
      const text = buf.toString('utf8')
      cached = Buffer.from(hasMarks(text) ? text : injectAsset(rel, text), 'utf8')
      ASSET_CACHE.set(key, cached)
    }
    buf = cached
    res.setHeader('X-Trace', SIG_TOKEN)
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache, must-revalidate',
  })
  res.end(buf)
}

function client () {
  const s = store.load()
  if (!s.token || !s.uid) return null
  return new LepaoClient(s)
}

function num (v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d }

function profileOf (zoneDec, userDec, indexDec) {
  const total = zoneDec?.running_stat?.total || {}
  const week = zoneDec?.running_stat?.week || {}
  return {
    nick_name: zoneDec?.user_info?.nick_name || userDec?.name || indexDec?.name || '',
    school_name: userDec?.school_name || indexDec?.school_name || '',
    avatar: zoneDec?.user_info?.avatar || indexDec?.avatar || '',
    total_valid_num: num(total.total_valid_num),
    total_valid_distance: num(total.total_valid_distance),
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍​‌‌‌‌‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​​‍​‌‌‌​‌​​‍​‌‌‌​​​​‍​‌‌‌​​‌‌‍​​‌‌‌​‌​‍​​‌​‌‌‌‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌​‌​​‌‍​‌‌‌​‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​‌‍​‌‌​​​‌​‍​​‌​‌‌‌​‍​‌‌​​​‌‌‍​‌‌​‌‌‌‌‍​‌‌​‌‌​‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌‌​‌​‌‍​‌‌​‌​​‌‍​‌‌​‌​​​‍​‌‌​​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌‌‍​​‌‌​​​‌‍​​‌‌​​‌​‍​​‌‌​​‌‌‍​​‌​‌‌‌‌‍​‌‌​‌‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌‌​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌​‌‌​‌‍​‌‌​​‌​‌‍⁣
    week_num: num(week.week_num),
    week_distance: num(week.week_distance),
  }
}

async function ensureAuth (res) {
  const s = store.load()
  const miss = fingerprintMissing(s)
  if (miss.length) {
    fail(res, 'NO_FINGERPRINT', `缺少设备指纹：${miss.join('、')}`, '在登录页/设置页补齐 mobileModel、mobileDeviceId、mobileOsVersion 后再试')
    return null
  }
  const c = client()
  if (!c) { fail(res, 'NO_SESSION', '未登录：请先在登录页填入 token / uid', '登录页支持手工粘贴，也可用 /api/session/sync 从本地桥读取'); return null }
  return c
}

function deviceWindows (session) {
  return {
    runStartTime: session?.rules_start,
    runEndTime: session?.rules_end,
  }
}

async function health () {
  const c = client()
  if (!c) return { alive: false, status: -1, info: '未登录' }
  try {
    const r = await c.myZone()
    if (r.status === 1) return { alive: true, status: 1, info: '正常' }
    if (isVersionGate(r)) {
      return {
        alive: false,
        status: 0,
        gate: 'version',
        version_name: c.s.version_name,
        info: `服务端要求升级：当前 version_name=${c.s.version_name} 已被判定过低`,
        hint: '设 LP_VERSION_NAME（例如 4.3.3）后重启服务；无需重新打包',
      }
    }
    if (r.status === 102) return { alive: false, status: 102, info: '该账号已在其他手机登录（被顶号），请在 App 重新登录后同步 token' }
    if (r.status === 101) {
      return {
        alive: false,
        status: 101,
        fingerprint: {
          mobileModel: c.s.mobileModel,
          mobileDeviceId: c.s.mobileDeviceId,
          mobileOsVersion: c.s.mobileOsVersion,
        },
        info: `登录信息失效（上游 101）：可能是 token 过期 / uid 不匹配 / 设备指纹不对。本次发出的是 ${c.s.mobileModel} / ${c.s.mobileDeviceId ?? '空'} / ${c.s.mobileOsVersion}`,
      }
    }
    const info = r.status === 100 ? (r.info || '参数错误：User/myZone 需要 visit_uid') : (r.info || `status=${r.status}`)
    return { alive: r.status === 100, status: r.status, info }
  } catch (e) {
    return { alive: false, status: -2, info: '网络错误：' + e.message }
  }
}

function failUpstream (res, r, c) {
  if (isVersionGate(r)) {
    return fail(res, 'VERSION_TOO_LOW', r.info, `本地 version_name=${c?.s?.version_name || '?'}；改 LP_VERSION_NAME 后重启即可`)
  }
  if (Number(r?.status) === -4 || r?.needFingerprint) {
    return fail(res, 'NO_FINGERPRINT', r.info, `缺：${(r.missing || []).join('、')}；在登录页/设置页补齐设备指纹后再试`)
  }
  return fail(res, 'UPSTREAM', r.info || `status=${r.status}`)
}

function fingerprintMissing (s) {
  const miss = []
  if (!String(s?.mobileModel || '').trim()) miss.push('mobileModel')
  if (!String(s?.mobileOsVersion || '').trim()) miss.push('mobileOsVersion')
  return miss
}

function failNoFingerprint (res, s) {
  const miss = fingerprintMissing(s)
  if (!miss.length) return null
  return fail(
    res,
    'NO_FINGERPRINT',
    `缺少设备指纹：${miss.join('、')}`,
    '请在登录页或设置页填写设备的 mobileModel / mobileDeviceId / mobileOsVersion（抓包里同一账号那三项原样填），或用「从本地桥同步」从真机采集',
  )
}

async function syncFromDevice({ uid = 0, serial = '', fingerprint = {} } = {}) {
  let useUid = Number(uid) || 0
  if (!useUid) {
    try {
      const { readDeviceMeta, scanAllHex } = await import('../scripts/lib/auth.mjs')
      const meta = await readDeviceMeta({ serial }).catch(() => null)
      if (meta?.uid) useUid = meta.uid
      if (!useUid) {
        const scan = await scanAllHex({ serial })
        const guess = scan.ok ? (scan.cands?.uids || []).find((u) => u.value) : null
        if (guess) useUid = guess.value
      }
    } catch {   }
  }
  const disk = store.load()

  let dev = {}
  try {
    dev = await deviceInfo({ serial })
  } catch {   }

  const pick = (v) => (v === undefined || v === null || String(v).trim() === '' ? undefined : String(v).trim())
  const fp = {
    mobileModel: pick(fingerprint.mobileModel) ?? pick(dev.mobileModel) ?? pick(disk.mobileModel),
    mobileDeviceId: fingerprint.mobileDeviceId !== undefined ? String(fingerprint.mobileDeviceId).trim() : undefined,
    mobileOsVersion: pick(fingerprint.mobileOsVersion) ?? pick(dev.mobileOsVersion) ?? pick(disk.mobileOsVersion),
  }
  const alt = disk.mobileModel && disk.mobileModel !== fp.mobileModel
    ? [{ mobileModel: disk.mobileModel, mobileOsVersion: disk.mobileOsVersion, mobileDeviceId: '' }]
    : []
  const r = await loginFromDevice({ uid: useUid, serial, verify: true, fingerprints: alt, ...fp })
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      info: r.info,
      error: r.error,
      needUid: !!r.needUid,
      needFingerprint: !!r.needFingerprint,
      missing: r.missing || [],
      trace: r.trace || [],
    }
  }
  const keep = {
    token: r.session.token,
    uid: r.session.uid,
    school_id: r.session.school_id,
    student_num: r.session.student_num,
    refresh_token: r.session.refresh_token,
    mobileModel: r.session.mobileModel,
    mobileDeviceId: r.session.mobileDeviceId,
    mobileOsVersion: r.session.mobileOsVersion,
    school_name: r.session.school_name,
    nick_name: r.session.nick_name,
    run_zone_id: r.session.run_zone_id,
    term_id: r.session.term_id,
  }
  store.invalidate()
  const kept = Object.fromEntries(
    Object.entries(keep).filter(([k, v]) => v !== undefined && (v !== '' || k === 'mobileDeviceId')),
  )
  const merged = store.save(kept)
  return { ok: true, session: merged, verified: !!r.verified, refreshed: !!r.refreshed, trace: r.trace || [] }
}

async function purgeSessionArtifacts () {
  const purged = []
  for (const id of [...device.runs.keys()]) {
    try { await device.stopRun(id) } catch {   }
    device.runs.delete(id)
    purged.push(`run:${id}`)
  }
  const dir = path.join(dataRoot(), 'data', 'device')
  try {
    for (const name of fs.readdirSync(dir)) {
      try {
        fs.rmSync(path.join(dir, name), { force: true, recursive: true })
        purged.push(`data/device/${name}`)
      } catch {   }
    }
  } catch {   }
  return purged
}

async function profileOrEmpty(s) {
  const empty = { nick_name: s?.nick_name || '', school_name: s?.school_name || '', avatar: '', total_valid_num: 0, total_valid_distance: 0, week_num: 0, week_distance: 0 }
  const c = client()
  if (!c) return empty
  try {
    const [zone, user, index] = await Promise.all([c.myZone(), c.user(), c.index().catch(() => ({}))])
    if (zone.status !== 1) return empty
    return profileOf(zone.dec, user.dec, index.dec)
  } catch {
    return empty
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
  const p = url.pathname
  try {
    applyCors(req, res)
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    if (!p.startsWith('/api/')) return serveStatic(req, res, p)

    if (p === '/api/health') return ok(res, { ok: true, version: VERSION })

    if (p === '/api/meta') return ok(res, { version: VERSION, sig: SIG_SHORT })

    if (p === '/api/session' && req.method === 'POST') {
      const b = await readBody(req)
      if (!b.token || !b.uid) return fail(res, 'BAD_REQUEST', 'token 与 uid 必填')

      const diskS = store.load()
      const incoming = {
        mobileModel: b.mobileModel !== undefined ? String(b.mobileModel).trim() : diskS.mobileModel,
        mobileDeviceId: b.mobileDeviceId !== undefined ? String(b.mobileDeviceId).trim() : diskS.mobileDeviceId,
        mobileOsVersion: b.mobileOsVersion !== undefined ? String(b.mobileOsVersion).trim() : diskS.mobileOsVersion,
      }
      if (!String(incoming.mobileDeviceId ?? '').trim()) {
        let scanned = []
        try {
          const online = ((await device.devices()).list || []).filter((d) => d.state === 'device')
          if (online.length) scanned = await findAppUuids({ serial: online[0].serial })
        } catch {   }
        const probe = deviceIdCandidates({
          session: incoming,
          cands: { deviceIds: scanned },
          extra: [{ mobileDeviceId: diskS.mobileDeviceId }],
        }).map((c) => c.value)
        const r = await verifySession(
          { ...diskS, ...incoming, token: String(b.token).trim(), uid: num(b.uid) },
          { deviceIds: probe },
        )
        if (r.ok && r.session) incoming.mobileDeviceId = r.session.mobileDeviceId
      }
      const gate = failNoFingerprint(res, incoming)
      if (gate) return gate

      const candidate = {
        ...diskS,
        token: String(b.token).trim(),
        uid: num(b.uid),
        school_id: num(b.school_id),
        student_num: String(b.student_num || '').trim(),
        ...(b.lpd3 ? { lpd3: String(b.lpd3) } : {}),
        mobileModel: incoming.mobileModel,
        mobileDeviceId: incoming.mobileDeviceId,
        mobileOsVersion: incoming.mobileOsVersion,
      }
      let c = new LepaoClient(candidate)
      const [zone, user, index] = await Promise.all([c.myZone(), c.user(), c.index().catch(() => ({}))])
      if (Number(zone.status) === -4 || zone.needFingerprint) {
        return failNoFingerprint(res, incoming) || fail(res, 'NO_FINGERPRINT', zone.info)
      }
      if (zone.status !== 1) {
        if (isVersionGate(zone)) {
          return fail(
            res,
            'VERSION_TOO_LOW',
            zone.info || '当前版本过低，请升级后使用~',
            `本地 version_name=${c.s.version_name}；设 LP_VERSION_NAME（如 4.3.3）后重启服务，无需重新打包`,
          )
        }
        return fail(
          res,
          'AUTH_FAILED',
          zone.info || `status=${zone.status}`,
          zone.status === 102
            ? '该 token 已被其它设备顶掉，请在 App 里重新登录并点「从本地桥同步」'
            : `检查 uid 是否与该 token 匹配；101 更多是设备指纹不对：服务端按 (token, uid, mobileModel, mobileDeviceId, mobileOsVersion) 定位会话，请填抓包里同一账号那三项（当前填的是 ${c.s.mobileModel} / ${c.s.mobileDeviceId ?? '空'} / ${c.s.mobileOsVersion}）`,
        )
      }
      store.save({
        token: candidate.token,
        uid: candidate.uid,
        school_id: num(index.dec?.school_id || candidate.school_id),
        student_num: String(index.dec?.number || candidate.student_num || ''),
        ...(candidate.lpd3 ? { lpd3: candidate.lpd3 } : {}),
        mobileModel: incoming.mobileModel,
        ...(incoming.mobileDeviceId !== undefined ? { mobileDeviceId: incoming.mobileDeviceId } : {}),
        mobileOsVersion: incoming.mobileOsVersion,
      })
      return ok(res, { session: store.load(), profile: profileOf(zone.dec, user.dec, index.dec) })
    }
    if (p === '/api/session' && req.method === 'GET') {
      const gate = failNoFingerprint(res, store.load())
      if (gate) return gate
      const c = client()
      if (!c) return fail(res, 'NO_SESSION', '未登录')
      const [zone, user, index] = await Promise.all([c.myZone(), c.user(), c.index().catch(() => ({}))])
      if (zone.status !== 1) {
        if (isVersionGate(zone)) return fail(res, 'VERSION_TOO_LOW', zone.info, `本地 version_name=${c.s.version_name}`)
        return fail(res, 'AUTH_FAILED', zone.info || `status=${zone.status}`)
      }
      return ok(res, { session: store.load(), profile: profileOf(zone.dec, user.dec, index.dec) })
    }
    if (p === '/api/session' && req.method === 'DELETE') {
      const had = store.load()
      const purged = await purgeSessionArtifacts()
      const wiped = store.clear()
      const file = path.join(dataRoot(), 'data', 'session.json')
      return ok(res, {
        cleared: true,
        hadSession: Boolean(had.token && had.uid),
        purged,
        fileRemoved: wiped.removed,
        fileEmptied: wiped.blanked,
        fileExists: fs.existsSync(file),
      })
    }
    if (p === '/api/session/health') {
      const s0 = store.load()
      if (!s0.token || !s0.uid) return ok(res, { alive: false, status: -1, info: '未登录' })
      const miss = fingerprintMissing(s0)
      if (miss.length) {
        return ok(res, {
          alive: false,
          status: -4,
          needFingerprint: true,
          missing: miss,
          info: `缺少设备指纹：${miss.join('、')}（服务端用 token+uid+指纹 定位会话，缺失必然 101）`,
        })
      }
      return ok(res, await health())
    }
    if (p === '/api/session/sync') {
      const body = req.method === 'POST' ? await readBody(req) : {}
      const wantLive = req.method === 'POST' || url.searchParams.get('live') === '1' || url.searchParams.get('live') === 'true'
      const uidArg = num(url.searchParams.get('uid'), 0) || num(body.uid, 0)
      const fpArg = body.fingerprint && typeof body.fingerprint === 'object' ? body.fingerprint : {}
      const dev = await device.devices()
      const online = (dev.list || []).filter((d) => d.state === 'device')
      if (!online.length) {
        return fail(
          res,
          'NO_DEVICE',
          '没有检测到可用的 adb 设备，本地桥同步不可用',
          dev.ok === false
            ? `adb 不可用：${dev.error || '找不到 adb 可执行文件'}；可在登录页手工填写 token / uid / 指纹`
            : '请用 USB 连接手机并打开 USB 调试，或在登录页填 host:5555 点「连接」；没有设备时请手工填写 token 登录',
        )
      }
      const serialArg = url.searchParams.get('serial') || String(body.serial || '') || ADB_DEVICE || online[0].serial
      const s = store.load()
      if (wantLive) {
        const r = await syncFromDevice({ uid: uidArg || num(s.uid), serial: serialArg, fingerprint: fpArg })
        if (!r.ok) {
          const code = r.needFingerprint ? 'NO_FINGERPRINT' : r.needUid ? 'NEED_UID' : r.status === 102 ? 'AUTH_KICKED' : r.status === 101 ? 'AUTH_FAILED' : 'SYNC_FAILED'
          return fail(res, code, r.error || r.info || '设备同步失败', (r.trace || []).slice(-6).join(' | '))
        }
        return ok(res, { session: r.session, profile: await profileOrEmpty(r.session), trace: r.trace, verified: r.verified, refreshed: !!r.refreshed })
      }
      if (!s.token) {
        const r = await syncFromDevice({ uid: uidArg || num(s.uid), serial: serialArg, fingerprint: fpArg })
        if (r.ok) return ok(res, { session: r.session, profile: await profileOrEmpty(r.session), trace: r.trace, verified: r.verified })
        const code = r.needFingerprint ? 'NO_FINGERPRINT' : 'NO_SESSION'
        return fail(res, code, r.error || '本地没有可同步的会话，设备侧也没采到', (r.error || r.trace?.slice(-3).join(' | ') || ''))
      }
      const miss = fingerprintMissing(s)
      if (miss.length) {
        const r = await syncFromDevice({ uid: uidArg || num(s.uid), serial: serialArg, fingerprint: fpArg })
        if (r.ok) return ok(res, { session: r.session, profile: await profileOrEmpty(r.session), trace: r.trace, verified: r.verified, repaired: true })
        return ok(res, {
          session: s,
          profile: { nick_name: '', school_name: '', avatar: '', total_valid_num: 0, total_valid_distance: 0, week_num: 0, week_distance: 0 },
          alive: false,
          status: -4,
          needFingerprint: true,
          missing: miss,
          info: `缺少设备指纹：${miss.join('、')}（服务端用 token+uid+指纹 定位会话）`,
        })
      }
      const v = await health()
      const profile = v.alive ? await profileOrEmpty(s) : { nick_name: '', school_name: '', avatar: '', total_valid_num: 0, total_valid_distance: 0, week_num: 0, week_distance: 0 }
      return ok(res, { session: s, profile, alive: v.alive, status: v.status, info: v.info })
    }

    if (p === '/api/terms') {
      const c = await ensureAuth(res); if (!c) return
      const r = await c.terms()
      if (r.status !== 1) return failUpstream(res, r, c)
      const list = (r.dec || []).map((t) => ({ term_id: String(t.term_id ?? t.id ?? ''), term_name: String(t.term_name ?? t.name ?? ''), status: String(t.status ?? '') }))
      return ok(res, list)
    }
    if (p === '/api/records') {
      const c = await ensureAuth(res); if (!c) return
      const termId = url.searchParams.get('term_id') || ''
      const page = num(url.searchParams.get('page'), 1)
      const r = await c.records(termId, page)
      if (r.status !== 1) return failUpstream(res, r, c)
      const d = r.dec || {}
      return ok(res, {
        total_num: num(d.total_num),
        total_score_num: num(d.total_score_num ?? d.valid_num),
        total_distance: num(d.total_distance),
        total_score_distance: num(d.total_score_distance ?? d.valid_distance),
        list: (d.list || []).map((x) => ({
          id: String(x.id ?? x.record_id ?? ''),
          start_time: String(x.start_time ?? ''),
          end_time: String(x.end_time ?? ''),
          distance: num(x.distance),
          used_time: num(x.used_time ?? x.time),
          record_status: num(x.record_status),
          run_score: num(x.run_score),
          title: String(x.title ?? x.run_zone_name ?? ''),
        })),
      })
    }
    if (p.startsWith('/api/records/')) {
      const c = await ensureAuth(res); if (!c) return
      const id = decodeURIComponent(p.slice('/api/records/'.length))
      const yearNum = num(url.searchParams.get('year_num'), new Date().getFullYear())
      const r = await c.recordDetail(id, yearNum)
      if (r.status !== 1) return failUpstream(res, r, c)
      const d = r.dec || {}
      let points = []
      try { points = await loadRecordTrack(d) } catch { points = [] }
      const stats = analyzeStats(points, 1800)
      const checkpoints = (d.point_list || []).map((x) => {
        const [lat, lng] = String(x.jingwei || '0,0').split(',').map(Number)
        return { id: String(x.id ?? x.point_id ?? ''), lat, lng, name: String(x.address ?? x.name ?? ''), hit: true }
      })
      return ok(res, {
        record: d,
        track: { points, checkpoints, stats, diagnostics: diagnose(stats, null) },
      })
    }

    if (p === '/api/zone') {
      const c = await ensureAuth(res); if (!c) return
      const s = store.load()
      const zr = await c.keyed('Run2/beforeRunV260').catch(() => ({}))
      if (isVersionGate(zr)) {
        return fail(res, 'VERSION_TOO_LOW', zr.info, `本地 version_name=${c.s.version_name}；设 LP_VERSION_NAME=4.3.3 后重启`)
      }
      const d = zr?.dec || {}
      const zone = await resolveRunZone(c, s, d)
      if (zone.gate) {
        return fail(res, 'VERSION_TOO_LOW', zone.gate.info, `本地 version_name=${c.s.version_name}；设 LP_VERSION_NAME=4.3.3 后重启`)
      }
      const tr = (d.time_rule_arr && d.time_rule_arr[0]) || {}
      const hasRules = Object.keys(tr).length > 0 || Boolean(d.run_zone_id) || Boolean(d.run_line_info)
      if (!zone.ok && !hasRules) {
        return fail(res, 'UPSTREAM', zone.info || zr?.info || `status=${zr?.status}`, '跑区规则拉取失败：多半是 token 被顶号（102）')
      }
      const zoneId = String(zone.zoneId || d.run_zone_id || s.zone_id || '')
      const zoneName = d.run_zone_name || s.zone_name || ''
      store.save({
        ...(zoneId ? { zone_id: zoneId, run_zone_id: zoneId } : {}),
        ...(zoneName ? { zone_name: zoneName } : {}),
      })
      return ok(res, {
        zone: { id: zoneId, name: zoneName || zone.zoneId },
        zoneInfo: {
          source: zone.ok ? 'GetZonePoints' : 'beforeRunV260',
          school_id: s.school_id ?? null,
          note: zone.info || '',
        },
        rules: {
          minDistanceKm: num(tr.min_distance, 1.5),
          maxDistanceKm: num(tr.max_distance, 10),
          minPaceSec: num(tr.min_pace, 540),
          maxPaceSec: num(tr.max_pace, 180),
          minLogNum: num(tr.min_log_num, 2),
          pointNumOnline: num(tr.point_num_online, 2),
          runStartTime: String(d.run_start_time ?? 0),
          runEndTime: String(d.run_end_time ?? 0),
          isCheckTime: Number(d.is_check_time ?? 0) === 1,
        },
        checkpoints: zone.points,
      })
    }

    if (p === '/api/track/preview' && req.method === 'POST') {
      const c = await ensureAuth(res); if (!c) return
      const b = await readBody(req)
      const s = store.load()
      const zr = await c.keyed('Run2/beforeRunV260').catch(() => ({}))
      if (isVersionGate(zr)) {
        return fail(res, 'VERSION_TOO_LOW', zr.info, `本地 version_name=${c.s.version_name}；设 LP_VERSION_NAME=4.3.3 后重启`)
      }
      const zone = await resolveRunZone(c, s, zr?.dec || {})
      if (zone.gate) {
        return fail(res, 'VERSION_TOO_LOW', zone.gate.info, `本地 version_name=${c.s.version_name}；设 LP_VERSION_NAME=4.3.3 后重启`)
      }
      if (!zone.points.length) {
        return fail(
          res,
          'NO_ZONE_POINTS',
          `当前跑区（zone_id=${zone.zoneId || '-'}）没有取到打卡点`,
          `${zone.info || 'GetZonePoints 与 beforeRunV260 都为空'}；确认账号学校是否已开通跑区，或先在设备页同步一次会话`,
        )
      }
      if (zone.zoneId) store.save({ zone_id: zone.zoneId, run_zone_id: zone.zoneId })
      const cps = zone.points
      const rules = { minDistanceKm: 1.5, maxDistanceKm: 10, minPaceSec: 540, maxPaceSec: 180, pointNumOnline: 2 }
      const targetKm = Math.min(10, Math.max(1.5, num(b.targetKm, 2)))
      const paceSec = Math.min(540, Math.max(180, num(b.paceSec, 330)))
      const nowSec = Math.floor(Date.now() / 1000)

      const radius = Math.min(200, Math.max(5, num(b.radius, 25)))
      const noisePct = Math.min(45, Math.max(0, num(b.noisePct, 8)))

      const path = (b.path || []).filter((q) => Array.isArray(q) && q.length >= 2 && Number.isFinite(Number(q[0])) && Number.isFinite(Number(q[1])))
      if (path.length < 2) {
        return fail(res, 'NO_PATH', '还没有手绘路径', '在「轨迹预览」地图上依次点击落点，画出路线后再生成')
      }

      const wantIds = Array.isArray(b.mustHit) && b.mustHit.length ? b.mustHit.map(String) : null

      const built = buildRunTrack({
        path,
        checkpoints: cps,
        mustHit: wantIds,
        targetKm,
        speed: Math.round((1000 / paceSec) * 100) / 100,
        intervalMs: 1800,
        noisePct,
        dwellFrames: 6,
        seed: b.seed || undefined,
      })

      const HIT_M = Math.max(1, Math.min(5, num(b.hitRadius, 2)))
      const trackCps = cps.map((c) => {
        let best = Infinity
        let bi = -1
        built.frames.forEach((f, i) => {
          const d = Math.hypot(
            (f.a - c.lat) * 111320,
            (f.o - c.lng) * 111320 * Math.cos((c.lat * Math.PI) / 180),
          )
          if (d < best) { best = d; bi = i }
        })
        return {
          id: String(c.id), name: c.name, lat: c.lat, lng: c.lng,
          hit: best <= HIT_M, distM: +best.toFixed(2), index: bi,
        }
      })
      const hitCps = trackCps.filter((c) => c.hit)
      const submitStats = analyzeStats(built.frames, built.intervalMs || 1800)
      const stats = {
        ...built.stats,
        ...submitStats,
        rawDistanceKm: built.stats.distanceKm,
        distanceKm: submitStats.distanceKm,
      }
      const diagnostics = diagnose(stats, rules)
      const pinned = built.hits.map((h) => ({ id: h.id, idx: h.index, geoDist: 0 }))

      const usedTime = Math.max(60, Number(stats.durationSec || Math.round((built.frames.length - 1) * 1.8)))
      const start = resolveStart({ meta: b, usedTime, nowTs: nowSec })
      const timing = planTiming({
        wantedTs: start.wantedTs,
        usedTime: start.usedTime,
        nowTs: nowSec,
        mode: start.mode,
      })
      const startAtTs = timing.startTs
      const endAtTs = timing.endTs
      const timeCheck = {
        startAt: startAtTs,
        endAt: endAtTs,
        usedTime: timing.usedTime,
        spanSlack: timing.spanSlack,
        startText: clockOf(startAtTs),
        endText: clockOf(endAtTs),
        mode: timing.mode,
        note: `${clockOf(startAtTs)} 开跑 · ${clockOf(endAtTs)} 停表（用时 ${timing.usedTime}s + 余量 ${timing.spanSlack}s）`,
      }

      const verdict = verdictOf(stats, trackCps, rules)
      return ok(res, {
        mode: 'manual',
        pins: built.pins ?? [],
        noiseTarget: noisePct,
        noiseActual: stats.noisePct,
        pathLengthM: Math.round(path.reduce((acc, q, i) => (i ? acc + meters(path[i - 1], q) : 0), 0)),
        loops: +(targetKm * 1000 / Math.max(1, built.stats.distanceKm * 1000)).toFixed(2),
        anchored: built.hits.map((h) => ({ id: h.id, name: h.name, index: h.index })),
        missed: trackCps.filter((c) => !c.hit).map((c) => ({ id: c.id, name: c.name, distM: c.distM })),
        points: built.frames,
        checkpoints: trackCps,
        stats,
        timeCheck,
        diagnostics,
        verdict,
        playSec: Math.round(built.frames.length * 1.8),
        hitCount: hitCps.length,
      })

    }

    if (p === '/api/submit' && req.method === 'POST') {
      const c = await ensureAuth(res); if (!c) return
      const b = await readBody(req)
      if (!Array.isArray(b.points) || b.points.length < 10) return fail(res, 'BAD_REQUEST', 'points 不足，先调用 /api/track/preview 生成轨迹')
      const id = createJob(b)
      return ok(res, { submitId: id })
    }
    if (p.startsWith('/api/submit/')) {
      const id = p.slice('/api/submit/'.length)
      const job = jobs.get(id)
      if (!job) return fail(res, 'NOT_FOUND', '提交任务不存在')
      return ok(res, job.toJSON())
    }

    if (p === '/api/device/status') {
      return ok(res, await device.status(deviceWindows(store.load())))
    }
    if (p === '/api/device/connect' && req.method === 'POST') {
      const b = await readBody(req)
      const r = await device.connect(b.host || b.serial || url.searchParams.get('host'))
      if (!r.ok) {
        const hint = r.missing
          ? device.adbHint()
          : '先确认手机已打开 USB 调试（或网络 adb），命令行 adb connect 能通；不确定环境就跑 node scripts/adb-doctor.mjs'
        return fail(res, 'ADB_CONNECT_FAILED', `连不上 ${r.target || '设备'}：${r.text || ''}`.trim(), hint)
      }
      return ok(res, { ...r, status: await device.status(deviceWindows(store.load())) })
    }
    if (p === '/api/device/devices') {
      const d = await device.devices()
      return ok(res, { ...d, adbDetail: device.adbInfoNow() })
    }
    if (p === '/api/device/frida/start' && req.method === 'POST') {
      try {
        const st = await device.startFrida()
        return ok(res, st)
      } catch (e) {
        return fail(res, 'FRIDA_START_FAILED', e.message || String(e))
      }
    }
    if (p === '/api/device/frida/stop' && req.method === 'POST') {
      return ok(res, await device.stopFrida())
    }
    if (p === '/api/device/probe' && req.method === 'POST') {
      return ok(res, await device.probeFrida(true))
    }
    if (p === '/api/device/run' && req.method === 'POST') {
      const b = await readBody(req)
      const id = await device.startRun(b.points || [], b.startAt)
      return ok(res, { runId: id })
    }
    if (p.startsWith('/api/device/run/') && p.endsWith('/stop') && req.method === 'POST') {
      const id = p.slice('/api/device/run/'.length, -'/stop'.length)
      const done = await device.stopRun(id)
      return ok(res, { ok: done })
    }
    if (p.startsWith('/api/device/run/')) {
      const id = p.slice('/api/device/run/'.length)
      const st = device.pollRun(id)
      if (!st) return fail(res, 'NOT_FOUND', '设备运行任务不存在')
      return ok(res, st)
    }

    return fail(res, 'NOT_FOUND', '未知接口：' + p, null, 404)
  } catch (e) {
    if (res.headersSent || res.writableEnded) {
      try { res.end() } catch {   }
      return undefined
    }
    return fail(res, 'INTERNAL', e.message || String(e))
  }
})

async function loadRecordTrack (detail) {
  const url = detail.file || detail.track_url || detail.run_record_url
  if (!url) return []
  const full = /^https?:/.test(url) ? url : `https://${String(url).replace(/^\/+/, '')}`
  const res = await fetch(full)
  if (!res.ok) return []
  const b64 = (await res.text()).replace(/\s+/g, '')
  const plain = decryptResponse(b64)
  const arr = JSON.parse(plain)
  return arr.map((x) => ({ a: Number(x.a), o: Number(x.o), s: Number(x.s || 0), l: Number(x.l || 1), ...(x.p ? { p: 1 } : {}) }))
}

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST
  console.log(`[lepao] http://${shown}:${PORT}  (static: ${IS_SEA ? 'embedded web/dist' : DIST})`)
  if (HOST === '0.0.0.0' || HOST === '::') {
    const nets = os.networkInterfaces()
    const ips = Object.values(nets).flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address)
    if (ips.length) console.log(`[lepao] 局域网可访问：${ips.map((ip) => `http://${ip}:${PORT}`).join('  ')}`)
  }
  console.log(`[lepao] listen: ${HOST}:${PORT}`)
  console.log(`[lepao] session: ${store.isLoggedIn() ? '已登录' : '未登录'}`)
  console.log('[lepao] 来源: ' + SIG_REPO)
  console.log('[lepao] 标识: ' + SIG_TOKEN)
  if (SIG_OK) {
    console.log('[lepao] 校验: ok')
  } else {
    console.log('[lepao] 校验: 与记录不一致')
  }
})
