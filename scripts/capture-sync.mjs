import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'
import { verifySession, hydrate } from './lib/auth.mjs'
import { installExitShim } from './lib/exit.mjs'

installExitShim()

const argv = process.argv.slice(2)
const has = (n) => argv.includes('--' + n)
const arg = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d) : null
}

const DIR = (arg('dir') ?? join(homedir(), 'Desktop')).replace(/^~/, homedir())
const PATTERN = arg('pattern', '*.txt')
const INTERVAL = Number(arg('interval', 2000))
const VERIFY = !has('no-verify')
const CREDS = 'creds.json'
const SESSION = 'session.json'

const FIELDS = {
  token: /["']?token["']?\s*[=:]\s*["']?([0-9A-Fa-f]{32})/,
  uid: /["']?uid["']?\s*[=:]\s*["']?(\d{1,12})/,
  school_id: /["']?school_id["']?\s*[=:]\s*["']?(\d{1,8})/,
  student_num: /["']?student_num["']?\s*[=:]\s*["']?([0-9A-Za-z]{4,24})/,
  mobileDeviceId: /["']?mobileDeviceId["']?\s*[=:]\s*["']?([0-9a-fA-F-]{20,40})/,
  mobileModel: /["']?mobileModel["']?\s*[=:]\s*["']?([A-Za-z0-9 _-]{2,24})/,
  mobileOsVersion: /["']?mobileOsVersion["']?\s*[=:]\s*["']?(\d{1,2})/,
  ostype: /["']?ostype["']?\s*[=:]\s*["']?(\d)/,
}

export function parseCapture(text) {
  const norm = (() => {
    try {
      return decodeURIComponent(text.replace(/\+/g, ' '))
    } catch {
      return text
    }
  })()

  const out = {}
  for (const [k, re] of Object.entries(FIELDS)) {
    let last = null
    const g = new RegExp(re.source, 'g')
    let m
    while ((m = g.exec(norm)) !== null) last = m[1]
    if (last != null) out[k] = last
  }

  if (!out.token) return null
  return {
    token: out.token.toUpperCase(),
    uid: Number(out.uid) || 0,
    school_id: Number(out.school_id) || 0,
    student_num: out.student_num ?? '',
    mobileDeviceId: out.mobileDeviceId ?? '',
    mobileModel: out.mobileModel ?? '',
    mobileOsVersion: out.mobileOsVersion ?? '',
    ostype: Number(out.ostype) || 1,
  }
}
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣

function globToRe(pat) {
  const esc = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp('^' + esc + '$', 'i')
}

function scanFiles(dir, pattern) {
  const re = globToRe(pattern)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => {
        const p = join(dir, f)
        try {
          const st = statSync(p)
          return st.isFile() ? { path: p, mtime: st.mtimeMs, size: st.size } : null
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

const j = (v) => JSON.stringify(v, null, 2) + '\n'
const seen = new Map()

async function importFile(f, { quiet = false } = {}) {
  let text
  try {
    text = readFileSync(f.path, 'utf8')
  } catch (e) {
    if (!quiet) console.error(`✗ 读不了 ${f.path}: ${e.message}`)
    return null
  }

  const s = parseCapture(text)
  if (!s || !s.uid) {
    if (!quiet) console.error(`✗ ${f.path} 里没找到 token / uid`)
    return null
  }

  const session = { ...s, source: 'capture', source_file: f.path, saved_at: new Date().toISOString() }

  if (VERIFY) {
    const v = await verifySession(session)
    if (v.ok) {
      const full = await hydrate(session)
      writeFileSync(CREDS, j(full), 'utf8')
      writeFileSync(SESSION, j(full), 'utf8')
      console.log(`✓ ${f.path}`)
      console.log(`  有效｜${full.school_name ?? ''} ${full.name ?? full.nick_name ?? ''}  uid=${full.uid}`)
      console.log(`  token=${full.token}`)
      return full
    }
    console.log(`✗ ${f.path} → ${v.status} ${v.info}`)
    writeFileSync(SESSION, j({ ...session, verify_status: v.status, verify_info: v.info }), 'utf8')
    return null
  }

  writeFileSync(CREDS, j(session), 'utf8')
  writeFileSync(SESSION, j(session), 'utf8')
  console.log(`✓ ${f.path}（未校验）token=${session.token} uid=${session.uid}`)
  return session
}

if (arg('file')) {
  const p = arg('file')
  const st = statSync(p)
  await importFile({ path: p, mtime: st.mtimeMs, size: st.size })
} else if (has('watch')) {
  console.log(`监听 ${DIR} / ${PATTERN}（每 ${INTERVAL / 1000}s 检查一次，Ctrl+C 退出）\n`)
  const tick = async () => {
    const files = scanFiles(DIR, PATTERN).slice(0, 5)
    for (const f of files) {
      if (seen.get(f.path) === f.mtime) continue
      seen.set(f.path, f.mtime)
      await importFile(f)
      console.log('')
    }
  }
  await tick()
  setInterval(tick, INTERVAL)
} else {
  const files = scanFiles(DIR, PATTERN)
  if (!files.length) {
    console.error(`在 ${DIR} 里没找到 ${PATTERN}`)
    process.exit(2)
  }
  console.log(`扫描到 ${files.length} 个文件，取最新的逐个试（最多 5 个）\n`)
  for (const f of files.slice(0, 5)) {
    const r = await importFile(f)
    if (r) break
  }
}
