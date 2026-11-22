import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { simulate, toView } from './simulate.mjs'
import { loadLocalCheckpoints, fetchRemoteCheckpoints, saveCheckpoints } from './checkpoints.mjs'
import { submitRun } from './submit-core.mjs'
import { buildPath } from './route.mjs'
import { rng } from './geo.mjs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json;charset=utf-8', ...CORS })
  res.end(JSON.stringify(obj))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const s = Buffer.concat(chunks).toString('utf8')
  if (!s) return {}
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d)

export function createSimHandler(opts = {}) {
  const root = opts.root ?? process.cwd()
  const abs = (f) => (isAbsolute(String(f)) ? String(f) : join(root, String(f)))
  const credsFile = abs(opts.credsFile ?? 'creds.json')
  const sessionFile = abs(opts.sessionFile ?? 'session.json')
  const cacheFile = abs(opts.protocolCache ?? 'protocol-cache.json')
  const outRoot = abs(opts.outRoot ?? 'out')
  const cpFile = abs(opts.checkpointsFile ?? 'checkpoints.json')
  const cpMetaFile = join(root, 'checkpoints-meta.json')
  const localCpFiles = [cpFile, join(root, 'route-plan.json')]

  const readSession = () => {
    for (const f of [sessionFile, credsFile]) {
      if (!existsSync(f)) continue
      try {
        const s = JSON.parse(readFileSync(f, 'utf8'))
        if (s?.token) return s
      } catch {
      }
    }
    return null
  }

  let healthCache = null
  let healthAt = 0
  const tokenHealth = async (force = false) => {
    if (!force && healthCache && Date.now() - healthAt < 30_000) return healthCache
    const session = readSession()
    if (!session) {
      healthCache = { ok: false, alive: false, info: '没有可用会话（creds.json / session.json）' }
      healthAt = Date.now()
      return healthCache
    }
    try {
      const { makeClient } = await import('./track-analysis.mjs')
      const r = await makeClient(session)('User/myZone')
      healthCache = {
        ok: r.status === 1,
        alive: r.status === 1,
        status: r.status,
        info: r.info ?? '',
        uid: session.uid,
        nick: r.data?.user_info?.nick_name ?? '',
        school: r.data?.user_info?.school_name ?? '',
      }
    } catch (e) {
      healthCache = { ok: false, alive: false, status: -2, info: e.message }
    }
    healthAt = Date.now()
    return healthCache
  }

  const genParams = (b) => ({
    paceSecPerKm: num(b.paceSecPerKm, 330),
    targetKm: num(b.targetKm, 2),
    seed: b.seed === '' || b.seed == null ? null : num(b.seed, null),
    mode: b.mode === 'seq' ? 'seq' : 'free',
    radius: num(b.radius, 30),
    sensorHz: num(b.sensorHz, 10),
    startTime: b.startTime ? Number(b.startTime) : null,
    routePoints: Array.isArray(b.routePoints) ? b.routePoints : [],
    checkpoints:
      Array.isArray(b.checkpoints) && b.checkpoints.length ? b.checkpoints : loadLocalCheckpoints(localCpFiles).list,
    compactSensors: true,
  })

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith('/sim')) return false

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return true
    }

    try {
      if (url.pathname === '/sim/health') {
        const tk = await tokenHealth(url.searchParams.get('force') === '1')
        const cps = loadLocalCheckpoints(localCpFiles)
        const protocol = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}
        json(res, 200, {
          ok: true,
          token: tk,
          checkpoints: { count: cps.list.length, source: cps.source, generatedAt: cps.generatedAt },
          protocol,
        })
        return true
      }

      if (url.pathname === '/sim/checkpoints' && req.method === 'GET') {
        const local = loadLocalCheckpoints(localCpFiles)
        const extra = readCheckpointMeta()
        json(res, 200, { ok: true, list: local.list, source: local.source, generatedAt: local.generatedAt, ...extra })
        return true
      }

      if (url.pathname === '/sim/token/scan') {
        const session = readSession()
        if (!session) {
          json(res, 200, { ok: false, reason: 'no-session', info: '没有可用会话' })
          return true
        }
        const { makeClient } = await import('./channel.mjs')
        const { readdirSync } = await import('node:fs')
        const cands = new Set()
        if (/^[0-9A-Fa-f]{32}$/.test(String(session.token ?? ''))) cands.add(String(session.token).toUpperCase())
        try {
          for (const f of readdirSync(join(root, '.tmp'))) {
            if (!/\.(txt|json|log)$/i.test(f)) continue
            const txt = readFileSync(join(root, '.tmp', f), 'utf8')
            for (const m of txt.matchAll(/\b[0-9A-F]{32}\b/g)) cands.add(m[0])
          }
        } catch {
        }
        const call = makeClient(session)
        const rows = []
        for (const t of [...cands].slice(0, 40)) {
          try {
            const r = await call('User/myZone', { token: t })
            rows.push({ token: t, status: r.status, alive: r.status === 1, info: r.info ?? '' })
          } catch (e) {
            rows.push({ token: t, status: -2, alive: false, info: e.message })
          }
        }
        const alive = rows.filter((r) => r.alive)
        json(res, 200, {
          ok: alive.length > 0,
          scanned: rows.length,
          aliveCount: alive.length,
          alive,
          rows,
          advice:
            alive.length > 0
              ? '有可用 token，直接提交即可'
              : '全部被顶掉：需要在手机上重新登录一次，再把新 token 填进来（App 与脚本不能同时在线，服务端单点登录）',
        })
        return true
      }

      if (url.pathname === '/sim/token' && req.method === 'POST') {
        const b = await readBody(req)
        const token = String(b.token ?? '').trim()
        if (!/^[0-9A-Fa-f]{32}$/.test(token)) {
          json(res, 200, { ok: false, info: 'token 格式应为 32 位十六进制' })
          return true
        }
        const session = readSession() ?? {}
        const next = { ...session, token, saved_at: new Date().toISOString(), source: 'manual' }
        writeFileSync(sessionFile, JSON.stringify(next, null, 2))
        writeFileSync(credsFile, JSON.stringify(next, null, 2))
        healthCache = null
        const tk = await tokenHealth(true)
        json(res, 200, { ok: tk.alive, token: tk })
        return true
      }

      if (url.pathname === '/sim/checkpoints/refresh') {
        const b = await readBody(req)
        const session = readSession()
        if (!session) {
          json(res, 200, { ok: false, reason: 'no-session', info: '没有可用会话' })
          return true
        }
        const progress = []
        try {
          const data = await fetchRemoteCheckpoints(session, {
            maxTerms: num(b.maxTerms, 3),
            maxRecords: num(b.maxRecords, 60),
            onProgress: (m) => progress.push(m),
          })
          saveCheckpoints(data, cpFile)
          healthCache = null
          const meta = { zone: data.zone ?? null, rules: data.rules ?? null, terms: data.terms ?? [] }
          writeCheckpointMeta(meta)
          json(res, 200, {
            ok: true,
            progress,
            list: data.checkpoints,
            source: cpFile,
            generatedAt: data.generatedAt,
            ...meta,
          })
        } catch (e) {
          json(res, 200, { ok: false, reason: 'fetch-failed', info: e.message, code: e.code ?? null, progress })
        }
        return true
      }

      if (url.pathname === '/sim/plan') {
        const b = await readBody(req)
        const cps =
          Array.isArray(b.checkpoints) && b.checkpoints.length ? b.checkpoints : loadLocalCheckpoints(localCpFiles).list
        const seed = num(b.seed, 1)
        const path = buildPath({
          points: Array.isArray(b.routePoints) ? b.routePoints : [],
          checkpoints: cps,
          targetKm: num(b.targetKm, 0),
          mode: b.mode === 'seq' ? 'seq' : 'free',
          r: rng(seed),
        })
        json(res, 200, { ok: true, path })
        return true
      }

      if (url.pathname === '/sim/generate') {
        const b = await readBody(req)
        const p = genParams(b)
        if (!p.checkpoints.length && !p.routePoints.length) {
          json(res, 200, { ok: false, reason: 'no-checkpoints', info: '没有打卡点，也没有指定路线' })
          return true
        }
        const result = simulate(p)
        persistRun(result)
        json(res, 200, { ok: true, ...toView(result), savedTo: join(outRoot, `sim-${result.seed}`) })
        return true
      }

      if (url.pathname === '/sim/submit') {
        const b = await readBody(req)
        const p = genParams(b)
        const dryRun = !!b.dryRun
        const logs = []
        const session = readSession()
        if (!session) {
          json(res, 200, { ok: false, reason: 'no-session', info: '没有可用会话（creds.json / session.json）', logs })
          return true
        }
        const result = simulate(p)
        persistRun(result)
        const hits = (result.meta.checkpoints ?? [])
          .filter((c) => c.hit)
          .map((c) => ({
            id: c.id ?? c.point_id,
            time: Number(c.hitTime ?? result.meta.startTime + Number(c.atSec ?? 0)),
          }))
        const r = await submitRun({
          session,
          points: result.points,
          meta: result.meta,
          stepNum: result.sensors.steps.total,
          zoneId: String(b.zoneId ?? result.meta.zoneId ?? ''),
          hits,
          dryRun,
          cacheFile,
          onLog: (e) => logs.push(e),
        })
        healthCache = null
        json(res, 200, { ok: r.ok, ...r, logs, view: toView(result) })
        return true
      }

      if (url.pathname === '/sim/protocol') {
        json(res, 200, existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {})
        return true
      }

      json(res, 404, { ok: false, info: `未知端点 ${url.pathname}` })
      return true
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    } catch (e) {
      json(res, 500, { ok: false, info: e.message, stack: process.env.SIM_DEBUG ? e.stack : undefined })
      return true
    }
  }

  function readCheckpointMeta() {
    const f = cpMetaFile
    if (!existsSync(f)) return {}
    try {
      return JSON.parse(readFileSync(f, 'utf8'))
    } catch {
      return {}
    }
  }

  function writeCheckpointMeta(meta) {
    writeFileSync(cpMetaFile, JSON.stringify(meta, null, 2))
  }

  function persistRun(result) {
    const dir = join(outRoot, `sim-${result.seed}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'track.json'), JSON.stringify(result.points))
    writeFileSync(
      join(dir, 'run.json'),
      JSON.stringify({ meta: result.meta, sensors: result.sensors, analysis: result.analysis, diagnosis: result.diagnosis }, null, 1),
    )
  }
}
