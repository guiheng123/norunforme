import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { loginFromDevice, verifySession, hydrate, probeDevice, scanAllHex, rememberFingerprint } from './lib/auth.mjs'
import { createAuthHandler } from './lib/local-server.mjs'
import { installExitShim } from './lib/exit.mjs'

installExitShim()

const argv = process.argv.slice(2)
const has = (n) => argv.includes('--' + n)
const arg = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d) : d
}

const CREDS = arg('out', 'creds.json')
const SESSION_FILE = arg('session', 'data/session.json')
const PORT = Number(arg('port', 8790))
const ADB = arg('adb', undefined)

const j = (v) => JSON.stringify(v, null, 2)

function ensureDir(file) {
  const dir = dirname(file)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function writeSession(session) {
  ensureDir(CREDS)
  ensureDir(SESSION_FILE)
  writeFileSync(CREDS, j(session) + '\n', 'utf8')
  writeFileSync(SESSION_FILE, j({ ...session, saved_at: new Date().toISOString() }) + '\n', 'utf8')
  rememberFingerprint(session)
}

async function syncOnce() {
  const dir = arg('dir', null)
  const uid = Number(arg('uid', 0)) || 0
  const verify = has('verify')
  console.log('=== 登录态同步 ===\n')
  if (!uid) console.log('提示：没有指定 --uid，会退回扫描到的 uid；不确定的话请手动传 --uid')
  if (!verify) console.log('模式：只读设备，不发任何请求（加 --verify 才校验一次）\n')
  const r = await loginFromDevice({ adb: ADB, serial: arg('serial', undefined), dir, uid, verify })
  for (const t of r.trace ?? []) console.log('· ' + t)
  if (!r.ok) {
    console.error(`\n✗ ${r.error ?? `校验未通过 status=${r.status} ${r.info ?? ''}`}`)
    if (r.cands) {
      const tk = r.cands.tokens
      console.error(`\n候选 token（${tk.length} 个，取第一个使用）:`)
      for (const t of tk.slice(0, 6)) {
        console.error(`  ${t.value}  [${t.confidence}] key=${t.key ?? '-'}  ← ${t.source}`)
        if (t.ctx) console.error(`      上下文: …${t.ctx}…`)
      }
      if (r.cands.uids.length) {
        console.error(`\n候选 uid: ${r.cands.uids.map((u) => u.value).join(', ')}`)
      }
    }
    if (r.needUid) {
      console.error('\n示例：node scripts/login-sync.mjs --uid 10000001 --verify')
    } else {
      console.error('\n101 = (token, uid) 查不到；102 = token 存在但已被顶下线。')
    }
    process.exit(2)
  }

  writeSession(r.session)
  const who = r.session.nick_name ? ` ${r.session.nick_name}` : ''
  const where = r.session.school_name ? ` @ ${r.session.school_name}` : ''
  console.log(`\n${r.verified ? '✓ 已同步并校验通过' : '✓ 已采集（未校验）'}${who}${where}`)
  console.log(`  uid=${r.session.uid} school_id=${r.session.school_id} student_num=${r.session.student_num}`)
  console.log(`  token=${r.session.token}`)
  console.log(`\n已写入 ${CREDS} 与 ${SESSION_FILE}。`)
  if (!r.verified) console.log('未发请求。确认这颗 token 可用的话，加 --verify 再跑一次（只发一次）。')
}

function serve() {
  const handler = createAuthHandler({ adb: ADB, credsFile: CREDS, sessionFile: SESSION_FILE })
  const server = createServer(async (req, res) => {
    await handler(req, res)
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`本地授权桥已启动： http://127.0.0.1:${PORT}`)
    console.log('  GET  /health        查看设备与 root 状态')
    console.log('  POST /auth/start    开始采集（mode=sync|wait）')
    console.log('  GET  /auth/status   轮询任务')
    console.log('\nWeb 端登录页点「微信登录」即可自动同步，Ctrl+C 退出。')
  })
}

async function checkOnly() {
  if (!existsSync(CREDS)) {
    console.error(`缺少 ${CREDS}`)
    process.exit(2)
  }
  const s = JSON.parse(readFileSync(CREDS, 'utf8'))
  const v = await verifySession(s)
  if (!v.ok) {
    console.error(`✗ token 失效 status=${v.status} ${v.info}`)
    process.exit(2)
  }
  const full = await hydrate(s)
  writeSession(full)
  console.log(`✓ 有效：${full.nick_name ?? ''} uid=${full.uid}`)
}

if (has('serve')) {
  serve()
} else if (has('connect')) {
  const { connectHost, listDevices } = await import('./lib/adb.mjs')
  const host = arg('connect')
  const c = await connectHost(host, { adb: ADB })
  console.log(`adb connect ${c.target} → ${c.ok ? 'ok' : '失败'}\n  ${c.text}`)
  const d = await listDevices(ADB)
  for (const dev of d.devices ?? []) console.log(`· ${dev.serial} (${dev.state})${dev.model ? ' model=' + dev.model : ''}`)
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  if (!c.ok) process.exit(2)
} else if (has('scan')) {
  console.log('=== 设备全盘扫描（32 位十六进制）===\n')
  const r = await scanAllHex({ adb: ADB, serial: arg('serial', undefined) })
  if (!r.ok) {
    console.error(`✗ ${r.error}`)
    process.exit(2)
  }
  if (r.groups.length === 0) {
    console.log('一个都没扫到 —— 说明 token 不是 32 位十六进制，或者被加密存储了。')
    process.exit(2)
  }
  console.log(`共 ${r.groups.length} 个不同的值：\n`)
  for (const g of r.groups.slice(0, 40)) {
    console.log(`${g.upper ? '大写' : '小写'} ×${String(g.count).padStart(3)}  ${g.value}`)
    for (const f of g.files.slice(0, 3)) console.log(`            ${f}`)
    if (g.files.length > 3) console.log(`            …另 ${g.files.length - 3} 个文件`)
  }
  console.log('\n乐跑 token 是 32 位大写十六进制 —— 优先看标「大写」且出现在 mmkv / shared_prefs 下的那些。')
  console.log('本命令只读设备、不发任何请求。要验一次请用 --verify（只发一次）。')
} else if (has('probe')) {
  console.log('=== 设备诊断 ===\n')
  const r = await probeDevice({ adb: ADB, serial: arg('serial', undefined) })
  if (!r.ok) {
    console.error(`\n✗ ${r.error}`)
    process.exit(2)
  }
  console.log('\n✓ 通道可用，可以跑 node scripts/login-sync.mjs')
} else if (has('check')) {
  await checkOnly()
} else if (arg('token', null)) {
  const s = { token: arg('token'), uid: Number(arg('uid', 0)), school_id: Number(arg('school_id', 0)), student_num: arg('student_num', '') }
  const v = await verifySession(s)
  if (!v.ok) {
    console.error(`✗ status=${v.status} ${v.info}`)
    process.exit(2)
  }
  writeSession(await hydrate(s))
  console.log('✓ 已写入 ' + CREDS)
} else {
  await syncOnce()
}
