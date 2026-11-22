#!/usr/bin/env node
// 内容签名工具：给源码与产物记录一次可复现的标识，并支持事后核对。
//   node tools/attest.mjs embed           重排标识 + 重写 .attest.json
//   node tools/attest.mjs verify [--json] 核对（0 正常 / 2 异常）
//   node tools/attest.mjs scan <dir>      核对任意目录
//   node tools/attest.mjs stamp <dir> --note 说明
//   node tools/attest.mjs info | report
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  SIG_SCHEMA, SIG_OWNER, SIG_REPO, SIG_ALLOW, SIG_FILE, SIG_PAYLOAD, SIG_DIGEST,
  SIG_SHORT, SIG_TOKEN, MARK_SHORT, MARK_FULL,
  encodeMarks, decodeMarks, stripMarks, countMarks, hasMarks, placeMarks, ensureMarks,
} from '../server/lib/attest.mjs'
import { noticeDigests, noticeProblems } from '../server/lib/notice-seal.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, SIG_FILE)
const LOG = path.join(ROOT, '.attest.log.jsonl')

const args = process.argv.slice(2)
const cmd = (args[0] || 'verify').replace(/^--/, '')
const has = (f) => args.includes('--' + f)
const arg = (n, d = null) => {
  const i = args.indexOf('--' + n)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d
}
const positional = args.slice(1).filter((a) => !a.startsWith('--'))

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.cache', '.tmp', '.vite', '.idea', '.vscode', '__pycache__',
  'dist', 'out', 'platform-tools', 'jadx', 'jdk', 'data', '.ai',
])
const SKIP_PATHS = ['build/.work', 'web/dist', 'web/node_modules', 'tools/platform-tools']
const SKIP_FILES = new Set(['package-lock.json', SIG_FILE, '.attest.log.jsonl', 'tsconfig.tsbuildinfo'])
const EMBED_EXT = new Set([
  '.mjs', '.js', '.cjs', '.ts', '.css', '.html', '.md', '.sh', '.py', '.ps1', '.txt', '.yml', '.yaml', '.jsonc', '.bat',
])
const TRACK_EXT = new Set([...EMBED_EXT, '.vue', '.json'])
const NO_MARK_FILES = new Set(['web/src/lib/notice-guard.ts'])
// 这些文件的标识用完整载荷（含地址），其余用短载荷
const FULL_FILES = new Set([
  'README.md', 'LICENSE', 'server/index.mjs', 'server/lib/attest.mjs', 'server/lib/attest-seal.mjs',
  'web/src/lib/attest.ts', 'tools/attest.mjs', 'tools/preflight.mjs', 'build/make-exe.mjs',
])

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')
const skipped = (p) => SKIP_PATHS.some((s) => rel(p) === s || rel(p).startsWith(s + '/'))

function walk (dir, acc = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || skipped(full)) continue
      walk(full, acc)
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name) || skipped(full)) continue
      if (TRACK_EXT.has(path.extname(e.name).toLowerCase())) acc.push(full)
    }
  }
  return acc
}

function readText (p) {
  try {
    const buf = fs.readFileSync(p)
    if (buf.length > 8 * 1024 * 1024 || buf.includes(0)) return null
    return buf.toString('utf8')
  } catch {
    return null
  }
}

function manifestOf (files) {
  const entries = {}
  let marked = 0
  for (const f of files) {
    const text = readText(f)
    if (text === null) continue
    const r = rel(f)
    const ok = hasMarks(text)
    entries[r] = {
      sha256: sha256(text),
      bytes: Buffer.byteLength(text),
      sig: ok,
      n: countMarks(text),
      at: ok ? decodeMarks(text).length : 0,
    }
    if (ok) marked += 1
  }
  const tree = sha256(Object.keys(entries).sort().map((k) => `${k}:${entries[k].sha256}`).join('\n'))
  const nd = noticeDigests(ROOT)
  return {
    schema: SIG_SCHEMA,
    owner: SIG_OWNER,
    repo: SIG_REPO,
    allow: SIG_ALLOW,
    digest: SIG_DIGEST,
    short: SIG_SHORT,
    token: SIG_TOKEN,
    files: entries,
    notice: {
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍​‌‌‌‌‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​​‍​‌‌‌​‌​​‍​‌‌‌​​​​‍​‌‌‌​​‌‌‍​​‌‌‌​‌​‍​​‌​‌‌‌‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌​‌​​‌‍​‌‌‌​‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​‌‍​‌‌​​​‌​‍​​‌​‌‌‌​‍​‌‌​​​‌‌‍​‌‌​‌‌‌‌‍​‌‌​‌‌​‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌‌​‌​‌‍​‌‌​‌​​‌‍​‌‌​‌​​​‍​‌‌​​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌‌‍​​‌‌​​​‌‍​​‌‌​​‌​‍​​‌‌​​‌‌‍​​‌​‌‌‌‌‍​‌‌​‌‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌‌​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌​‌‌​‌‍​‌‌​​‌​‌‍⁣
      schema: 1,
      hold: nd.hold,
      manual: nd.manualHold,
      items: nd.items,
      repo: nd.repo,
      text: nd.text,
      view: nd.view,
      guard: nd.guard,
    },
    stats: { tracked: Object.keys(entries).length, marked, treeDigest: tree },
    treeDigest: tree,
    updatedAt: new Date().toISOString(),
  }
}

function info () {
  if (has('json')) {
    console.log(JSON.stringify({
      schema: SIG_SCHEMA, owner: SIG_OWNER, repo: SIG_REPO, allow: SIG_ALLOW,
      payload: SIG_PAYLOAD, digest: SIG_DIGEST, short: SIG_SHORT, token: SIG_TOKEN,
      markShort: MARK_SHORT, markFull: MARK_FULL,
      chars: { short: countMarks(encodeMarks(MARK_SHORT)), full: countMarks(encodeMarks(MARK_FULL)) },
    }, null, 2))
    return 0
  }
  console.log(`${SIG_REPO}  ·  ${SIG_OWNER}  ·  ${SIG_ALLOW}`)
  console.log(`token   ${SIG_TOKEN}`)
  console.log(`digest  ${SIG_DIGEST}`)
  console.log(`mark    ${MARK_SHORT}  /  ${MARK_FULL}`)
  console.log(`chars   ${countMarks(encodeMarks(MARK_SHORT))} / ${countMarks(encodeMarks(MARK_FULL))}`)
  return 0
}

function embed () {
  const files = walk(ROOT)
  let written = 0
  let marked = 0
  for (const f of files) {
    const ext = path.extname(f).toLowerCase()
    if (!EMBED_EXT.has(ext)) continue
    const text = readText(f)
    if (text === null) continue
    const r = rel(f)
    if (NO_MARK_FILES.has(r)) continue
    const next = placeMarks(text, ext, r, FULL_FILES.has(r) ? MARK_FULL : MARK_SHORT)
    if (next !== text) {
      fs.writeFileSync(f, next, 'utf8')
      written += 1
    }
    if (hasMarks(next)) marked += 1
  }
  const manifest = manifestOf(walk(ROOT))
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`[sig] 更新 ${written} 个文件，覆盖 ${manifest.stats.marked}/${manifest.stats.tracked}`)
  console.log(`[sig] ${SIG_FILE}  tree ${manifest.treeDigest.slice(0, 16)}  ${SIG_TOKEN}`)
  return 0
}

function digestIn (text) {
  const m = String(text).match(/\b([0-9a-f]{64})\b/)
  return m ? m[1] : null
}

function check () {
  const problems = []
  if (!fs.existsSync(MANIFEST)) {
    problems.push(`${SIG_FILE} 缺失`)
    return problems
  }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  for (const [file, re] of Object.entries({
    'server/lib/attest-seal.mjs': /SEAL_DIGEST\s*=\s*'([0-9a-f]{64})'/,
    'web/src/lib/attest.ts': /SIG_DIGEST\s*=\s*'([0-9a-f]{64})'/,
    'web/vite.config.ts': /SIG_DIGEST\s*=\s*'([0-9a-f]{64})'/,
  })) {
    const t = readText(path.join(ROOT, file))
    if (!t) { problems.push(`${file} 缺失`); continue }
    const d = (t.match(re) || [])[1]
    if (!d) problems.push(`${file} 常量缺失`)
    else if (d !== m.digest) problems.push(`${file} 常量与记录不符`)
  }
  if (m.digest !== SIG_DIGEST) problems.push('运行期常量与记录不符')

  const files = m.files || {}
  const marked = Object.entries(files).filter(([, v]) => v.sig)
  const lost = []
  let changed = 0
  let gone = 0
  for (const [r, meta] of Object.entries(files)) {
    const full = path.join(ROOT, r)
    if (!fs.existsSync(full)) { gone += 1; continue }
    const text = readText(full)
    if (text === null) continue
    if (sha256(text) !== meta.sha256) changed += 1
    if (meta.sig && !hasMarks(text)) lost.push(r)
  }
  const ratio = marked.length ? lost.length / marked.length : 0
  if (ratio > 0.4) problems.push(`标识覆盖率异常：${lost.length}/${marked.length} 个文件失去标识`)

  for (const [file, needle] of Object.entries({
    LICENSE: SIG_ALLOW,
    'package.json': 'guiheng123',
  })) {
    const t = readText(path.join(ROOT, file)) || ''
    if (!t.includes(needle)) problems.push(`${file} 内容与声明不符`)
  }

  const nd = noticeDigests(ROOT)
  for (const p of noticeProblems(ROOT, SIG_REPO)) problems.push(`使用须知 ${p}`)
  if (!m.notice) problems.push('使用须知 记录缺少条目')
  else if (m.notice.text !== nd.text || m.notice.view !== nd.view || m.notice.guard !== nd.guard) {
    problems.push('使用须知 记录与现状不符')
  }
  return problems
}

function verify () {
  const problems = check()
  const m = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null
  const files = Object.values(m?.files || {})
  const marked = files.filter((v) => v.sig).length
  const lost = files.filter((v) => v.sig).length - marked
  const out = {
    ok: problems.length === 0,
    token: SIG_TOKEN,
    digest: SIG_DIGEST,
    tracked: files.length,
    marked,
    problems,
  }
  if (has('json')) {
    console.log(JSON.stringify(out, null, 2))
    return out.ok ? 0 : 2
  }
  console.log(`[sig] ${SIG_TOKEN}  ${SIG_REPO}`)
  console.log(`[sig] 记录 ${out.tracked} 个文件，带标识 ${marked} 个`)
  if (out.ok) console.log('[sig] 核对通过')
  else problems.forEach((p) => console.log('[sig] 异常：' + p))
  return out.ok ? 0 : 2
}

function scan () {
  const target = positional[0] || arg('dir') || '.'
  const dir = path.resolve(process.cwd(), target)
  if (!fs.existsSync(dir)) {
    console.log('[sig] 目录不存在：' + dir)
    return 2
  }
  const hits = []
  let n = 0
  const walkAny = (d, depth = 0) => {
    if (depth > 8) return
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue
        walkAny(full, depth + 1)
      } else if (e.isFile()) {
        if (!TRACK_EXT.has(path.extname(e.name).toLowerCase())) continue
        const text = readText(full)
        if (text === null) continue
        n += 1
        const marks = decodeMarks(text)
        if (marks.length) hits.push({ file: path.relative(dir, full).replace(/\\/g, '/'), marks })
      }
    }
  }
  walkAny(dir)
  console.log(`[sig] 扫描 ${n} 个文本文件，命中 ${hits.length} 个`)
  for (const h of hits.slice(0, 8)) console.log(`      ${h.file}  →  ${h.marks[0]}`)
  if (hits.length > 8) console.log(`      … 另有 ${hits.length - 8} 个`)
  if (!hits.length) console.log('[sig] 未命中')
  return hits.length ? 0 : 1
}

function stamp () {
  const target = positional[0] || arg('dir') || arg('file')
  if (!target) {
    console.log('[sig] 用法：node tools/attest.mjs stamp <目录或文件> [--note 说明]')
    return 2
  }
  const full = path.resolve(process.cwd(), target)
  if (!fs.existsSync(full)) {
    console.log('[sig] 不存在：' + full)
    return 2
  }
  const targets = []
  if (fs.statSync(full).isDirectory()) targets.push(...walk(full))
  else targets.push(full)
  let touched = 0
  for (const f of targets) {
    const ext = path.extname(f).toLowerCase()
    if (!EMBED_EXT.has(ext)) continue
    const text = readText(f)
    if (text === null || hasMarks(text)) continue
    fs.writeFileSync(f, placeMarks(text, ext, rel(f)), 'utf8')
    touched += 1
  }
  fs.appendFileSync(LOG, JSON.stringify({
    at: new Date().toISOString(), action: 'stamp', target: full, files: touched,
    note: arg('note', '') || '', token: SIG_TOKEN, digest: SIG_DIGEST,
  }) + '\n', 'utf8')
  console.log(`[sig] 已处理 ${touched} 个文件：${full}`)
  return 0
}

function report () {
  if (!fs.existsSync(MANIFEST)) {
    console.log('[sig] 还没有记录，先跑 node tools/attest.mjs embed')
    return 2
  }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  const files = Object.entries(m.files || {})
  const marked = files.filter(([, v]) => v.sig).length
  const full = files.filter(([, v]) => v.sig && decodeMarks(readText(path.join(ROOT, 'unused')) || '').length === 0).length
  console.log(`[sig] ${m.repo}  ${m.short}`)
  console.log(`[sig] 记录 ${files.length}  ·  带标识 ${marked}  ·  未标识 ${files.length - marked}`)
  console.log(`[sig] 更新时间 ${m.updatedAt}`)
  const logLines = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0
  console.log(`[sig] 流水 ${logLines} 条`)
  void full
  return 0
}

const table = { info, embed, verify, scan, stamp, report }
const fn = table[cmd]
if (!fn) {
  console.log(`[sig] 未知命令 ${cmd}：${Object.keys(table).join(' / ')}`)
  process.exit(2)
}
process.exit(fn() ?? 0)
