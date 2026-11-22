#!/usr/bin/env node
// 构建前自检：核对工作区与本项目的封存记录是否一致。
// 只要一致就静默通过；不一致才中止，避免干扰正常开发与维护。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { SIG_DIGEST, SIG_SHORT, SIG_REPO, hasMarks } from '../server/lib/attest.mjs'
import { noticeDigests, noticeProblems } from '../server/lib/notice-seal.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, '.attest.json')
const quiet = process.argv.includes('--quiet')
const force = process.env.LP_SKIP_PREFLIGHT === '1'

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const read = (p) => {
  try {
    return fs.readFileSync(path.join(ROOT, p), 'utf8')
  } catch {
    return null
  }
}

const problems = []

if (!fs.existsSync(MANIFEST)) {
  problems.push('E1 缺少封存记录')
} else {
  let m = null
  try {
    m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  } catch {
    problems.push('E2 封存记录不可读')
  }
  if (m) {
    if (m.digest !== SIG_DIGEST) problems.push('E3 常量与流水不一致')
    for (const [file, re] of Object.entries({
      'server/lib/attest-seal.mjs': /SEAL_DIGEST\s*=\s*'([0-9a-f]{64})'/,
      'web/src/lib/attest.ts': /SIG_DIGEST\s*=\s*'([0-9a-f]{64})'/,
      'web/vite.config.ts': /SIG_DIGEST\s*=\s*'([0-9a-f]{64})'/,
    })) {
      const t = read(file)
      if (!t) { problems.push(`E4 ${file} 缺失`); continue }
      const d = (t.match(re) || [])[1]
      if (!d) problems.push(`E5 ${file} 常量缺失`)
      else if (d !== m.digest) problems.push(`E6 ${file} 常量被改`)
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍​‌‌‌‌‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​​‍​‌‌‌​‌​​‍​‌‌‌​​​​‍​‌‌‌​​‌‌‍​​‌‌‌​‌​‍​​‌​‌‌‌‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌​‌​​‌‍​‌‌‌​‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​‌‍​‌‌​​​‌​‍​​‌​‌‌‌​‍​‌‌​​​‌‌‍​‌‌​‌‌‌‌‍​‌‌​‌‌​‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌‌​‌​‌‍​‌‌​‌​​‌‍​‌‌​‌​​​‍​‌‌​​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌‌‍​​‌‌​​​‌‍​​‌‌​​‌​‍​​‌‌​​‌‌‍​​‌​‌‌‌‌‍​‌‌​‌‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌‌​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌​‌‌​‌‍​‌‌​​‌​‌‍⁣
    }
    const files = Object.entries(m.files || {})
    const marked = files.filter(([, v]) => v.sig)
    const lost = []
    for (const [r, meta] of marked) {
      const t = read(r)
      if (t === null) continue
      if (!hasMarks(t)) lost.push(r)
    }
    const ratio = marked.length ? lost.length / marked.length : 0
    if (ratio > 0.4) problems.push(`E7 覆盖率 ${(ratio * 100).toFixed(0)}%`)

    const nd = noticeDigests(ROOT)
    if (!m.notice) problems.push('E18 记录缺少条目')
    else if (
      m.notice.text !== nd.text ||
      m.notice.view !== nd.view ||
      m.notice.guard !== nd.guard ||
      m.notice.manual !== nd.manualHold
    ) {
      problems.push('E18 记录与现状不符')
    }
  }
}

const license = read('LICENSE') || ''
if (!license.includes('禁止倒卖')) problems.push('E8 LICENSE 声明缺失')

const pkg = read('package.json') || ''
if (!pkg.includes('guiheng123')) problems.push('E9 归属信息被改')

const noticeCode = (p) => {
  if (p.startsWith('notice-missing:')) return 'E10'
  if (p.startsWith('notice-seal')) return 'E11'
  if (p.endsWith('-drift')) return 'E12'
  if (p === 'notice-text-unreadable') return 'E13'
  if (p === 'notice-items-short') return 'E14'
  if (p === 'notice-manual-short') return 'E20'
  return 'E15'
}
for (const code of new Set(noticeProblems(ROOT, SIG_REPO).map(noticeCode))) {
  problems.push(`${code} 资源与封存记录不一致`)
}

const entry = read('web/src/main.ts') || ''
if (!entry.includes('installNoticeGuard(')) problems.push('E16 主入口缺少必需环节')

const shell = read('web/src/App.vue') || ''
if (!shell.includes('<NoticeModal')) problems.push('E17 界面缺少必需环节')
if (!shell.includes("from './components/NoticeModal.vue'")) problems.push('E17 界面缺少必需环节')

const panel = read('web/src/pages/SettingsPage.vue') || ''
if (!panel.includes('<NoticeModal')) problems.push('E19 设置缺少必需环节')
if (!panel.includes("from '../components/NoticeModal.vue'")) problems.push('E19 设置缺少必需环节')

if (!problems.length) {
  if (!quiet) console.log('[preflight] ok')
  process.exit(0)
}

if (force) {
  console.log('[preflight] 已跳过（LP_SKIP_PREFLIGHT=1）')
  process.exit(0)
}

try {
  fs.appendFileSync(path.join(ROOT, '.attest.log.jsonl'), JSON.stringify({
    at: new Date().toISOString(), action: 'preflight-block', code: SIG_SHORT, problems,
  }) + '\n', 'utf8')
} catch {
  /* 记账失败不影响判定 */
}

const line = '─'.repeat(58)
console.log(line)
console.log(' 构建中止：工作区与封存记录不一致')
console.log(` 校验码 ${SIG_SHORT}`)
console.log(line)
problems.forEach((p) => console.log('  ' + p))
console.log(line)
console.log('')
process.exit(2)
