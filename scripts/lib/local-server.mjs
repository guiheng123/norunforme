import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { loginFromDevice, verifySession, hydrate, rememberFingerprint } from './auth.mjs'
import { listDevices, hasRoot, launchApp, currentActivity, PKG, connectHost, deviceInfo } from './adb.mjs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json;charset=utf-8', ...CORS, 'Cache-Control': 'no-store' })
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

const j = (v) => JSON.stringify(v, null, 2)

const pickFp = (s) => ({
  mobileModel: s.mobileModel,
  mobileDeviceId: s.mobileDeviceId,
  mobileOsVersion: s.mobileOsVersion,
})

export function createAuthHandler(opts = {}) {
  const credsFile = opts.credsFile ?? 'creds.json'
  const sessionFile = opts.sessionFile ?? 'data/session.json'
  const timeoutSec = opts.timeoutSec ?? 120

  const tasks = new Map()
  let latest = null

  if (existsSync(sessionFile)) {
    try {
      latest = JSON.parse(readFileSync(sessionFile, 'utf8'))
    } catch {
    }
  }

  const persist = (session) => {
    const payload = { ...session, saved_at: new Date().toISOString() }
    writeFileSync(credsFile, j(session) + '\n', 'utf8')
    writeFileSync(sessionFile, j(payload) + '\n', 'utf8')
    rememberFingerprint(session)
    latest = payload
  }

  async function currentDevice(preferred) {
    const devs = await listDevices(opts.adb)
    if (!devs.ok) return { ok: false, error: `adb 不可用：${devs.error ?? ''}`, devs }
    const dev = (preferred && devs.devices.find((d) => d.serial === preferred)) ||
      devs.devices.find((d) => d.serial === devs.preferred)
    return { ok: true, dev, devs }
  }

  async function settle(task, r) {
    task.trace = r.trace ?? []
    if (r.ok) {
      let session = r.session
      try {
        const v = await verifySession(session)
        if (v.ok) session = await hydrate(v.session ? { ...session, ...pickFp(v.session) } : session)
        else if (v.status === 101 || v.status === 102) {
          task.trace.push(`落盘前复验 ${v.status}（按记录用，不再重试）`)
        }
      } catch {
      }
      persist(session)
      Object.assign(task, {
        state: 'ok',
        session,
        message: r.verified ? `同步成功：${session.nick_name || session.school_name || session.uid}` : '已采集到 token（未校验）',
      })
    } else {
      Object.assign(task, {
        state: 'fail',
        message: r.error ?? `校验未通过 ${r.status ?? ''} ${r.info ?? ''}`.trim(),
        needUid: !!r.needUid,
        status: r.status ?? null,
      })
    }
  }

  async function runTask(task) {
    try {
      if (task.mode === 'wait') {
        const ch = task.channel === 'qq' ? 'QQ 登录' : task.channel === 'wechat' ? '微信登录' : '微信 / QQ 登录'
        const cur = await currentDevice(task.serial)
        if (!cur.ok) {
          Object.assign(task, { state: 'fail', message: cur.error })
          return
        }
        if (!cur.dev) {
          Object.assign(task, {
            state: 'fail',
            message: '没有可用的手机（USB 调试未授权 / 没连上）',
          })
          task.trace.push('打开开发者选项 → USB 调试，或用 /connect 连 host:5555 后重试')
          return
        }
        const dev = cur.dev
        const la = await launchApp({ adb: opts.adb, serial: dev.serial })
        task.message = la.ok
          ? `已拉起步道乐跑，请在手机上点「${ch}」`
          : `请手动打开手机上的步道乐跑，点「${ch}」`
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
        task.trace.push(task.message)

        const baselineRun = await loginFromDevice({ adb: opts.adb, serial: dev.serial, uid: task.uid, verify: true, refresh: true })
        if (baselineRun.ok) {
          await settle(task, { ...baselineRun, verified: true })
          task.message = `设备里已有有效会话，无需重新登录（${task.session?.nick_name || task.session?.uid}）`
          return
        }
        const baseline = baselineRun.session?.token
        task.trace.push(`基线状态：${baselineRun.status ?? '-'} ${String(baselineRun.info || '').slice(0, 32)}${baseline ? `（token=${baseline.slice(0, 8)}…）` : ''}`)

        const deadline = Date.now() + timeoutSec * 1000
        while (Date.now() < deadline) {
          const r = await loginFromDevice({ adb: opts.adb, serial: dev.serial, uid: task.uid, verify: true, refresh: true })
          task.trace = r.trace ?? task.trace
          if (r.ok) {
            await settle(task, { ...r, verified: true })
            return
          }
          const tok = r.session?.token
          if (tok && tok !== baseline && r.verified) {
            task.message = `检测到新 token（${tok.slice(0, 8)}…），校验未过，继续等`
          } else {
            const left = Math.max(0, Math.round((deadline - Date.now()) / 1000))
            task.message = `等待手机端授权…剩余 ${left}s（请在 App 里完成${ch}）`
          }
          await new Promise((r2) => setTimeout(r2, 3000))
        }
        task.state = 'fail'
        task.message = '超时：手机本地存储里没出现有效 token'
        return
      }

      const r = await loginFromDevice({
        adb: opts.adb,
        serial: task.serial,
        uid: task.uid,
        verify: task.verify !== false,
        refresh: task.refresh !== false,
      })
      if (r.ok) await settle(task, r)
      else await settle(task, r)
    } catch (e) {
      Object.assign(task, { state: 'fail', message: e.message || String(e) })
    }
  }

  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname.replace(/^\/local/, '') || '/'

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return true
    }

    try {
      if (path === '/' || path === '/health') {
        const cur = await currentDevice(url.searchParams.get('serial') || undefined)
        if (!cur.ok) {
          send(res, 200, { ok: true, adb: false, adbError: cur.error, device: null, state: null, root: false, hasSession: !!latest })
          return true
        }
        const dev = cur.dev
        const root = dev?.state === 'device' ? await hasRoot(opts.adb, dev.serial) : false
        const act = dev?.state === 'device' ? await currentActivity({ adb: opts.adb, serial: dev.serial }) : null
        const info = dev?.state === 'device' ? await deviceInfo({ adb: opts.adb, serial: dev.serial }) : null
        send(res, 200, {
          ok: true,
          adb: true,
          device: dev?.serial ?? null,
          state: dev?.state ?? null,
          root,
          info,
          devices: cur.devs.devices,
          foreground: act,
          appInFront: typeof act === 'string' && act.startsWith(PKG),
          hasSession: !!latest,
          sessionUid: latest?.uid ?? null,
        })
        return true
      }

      if (path === '/session') {
        try {
          if (existsSync(sessionFile)) {
            const fresh = JSON.parse(readFileSync(sessionFile, 'utf8'))
            if (fresh?.token) latest = fresh
          }
        } catch {
        }
        if (!latest) {
          send(res, 404, { ok: false, error: '还没有会话' })
          return true
        }
        const v = await verifySession(latest)
        let session = latest
        if (v.ok) {
          session = await hydrate(latest)
          latest = session
        }
        send(res, 200, { ok: true, session, alive: v.ok, status: v.status, info: v.info })
        return true
      }

      if (path === '/connect' && req.method === 'POST') {
        const body = await readBody(req)
        const r = await connectHost(body.host || url.searchParams.get('host'), { adb: opts.adb })
        send(res, 200, r)
        return true
      }

      if (path === '/launch' && req.method === 'POST') {
        const cur = await currentDevice()
        const r = await launchApp({ adb: opts.adb, serial: cur.dev?.serial })
        send(res, 200, { ok: r.ok, info: String(r.stdout || r.stderr).slice(0, 300) })
        return true
      }

      if (path === '/auth/start' && req.method === 'POST') {
        const body = await readBody(req)
        const mode = body.mode === 'wait' ? 'wait' : 'sync'
        const channel = body.channel === 'qq' ? 'qq' : body.channel === 'wechat' ? 'wechat' : 'both'
        let uid = Number(body.uid) || 0
        if (!uid && latest?.uid) uid = Number(latest.uid) || 0
        const id = Math.random().toString(36).slice(2, 10)
        const task = {
          id,
          mode,
          channel,
          uid,
          serial: body.serial || undefined,
          verify: body.verify !== false,
          refresh: body.refresh !== false,
          state: 'running',
          message: '开始采集…',
          trace: [],
          createdAt: Date.now(),
        }
        tasks.set(id, task)
        runTask(task)
        send(res, 200, { ok: true, taskId: id, uid })
        return true
      }

      if (path === '/auth/status') {
        const id = url.searchParams.get('id')
        const task = tasks.get(id)
        if (!task) {
          send(res, 404, { ok: false, error: '任务不存在' })
          return true
        }
        send(res, 200, {
          ok: true,
          state: task.state,
          message: task.message,
          session: task.session ?? null,
          needUid: !!task.needUid,
          status: task.status ?? null,
          trace: (task.trace ?? []).slice(-12),
        })
        return true
      }

      send(res, 404, { ok: false, error: 'not found: ' + path })
      return true
    } catch (e) {
      send(res, 500, { ok: false, error: e.message })
      return true
    }
  }
}
