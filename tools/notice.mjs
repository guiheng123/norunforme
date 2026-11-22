#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MARK_SHORT, placeMarks } from '../server/lib/attest.mjs'
import {
  NOTICE_TEXT, NOTICE_VIEW, NOTICE_GUARD, NOTICE_SEAL, NOTICE_MIN_HOLD, NOTICE_MIN_MANUAL, NOTICE_MIN_ITEMS,
  NOTICE_REPO_PIN, noticeDigests, noticeProblems, readSeal, sealSource,
} from '../server/lib/notice-seal.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, '.attest.json')
const cmd = (process.argv[2] || 'diff').replace(/^--/, '')

const sha = (v) => (v === null ? '缺失' : v.slice(0, 16))

function updateManifest (d) {
  let m
  try {
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  } catch {
    console.log(`[notice] 没有可用的 .attest.json，先跑 node tools/attest.mjs embed`)
    return false
  }
  m.notice = {
    schema: 1,
    hold: d.hold,
    manual: d.manualHold,
    items: d.items,
    repo: d.repo,
    text: d.text,
    view: d.view,
    guard: d.guard,
    at: new Date().toISOString(),
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n', 'utf8')
  return true
}

function seal () {
  const d = noticeDigests(ROOT)
  if (d.missing.length) {
    console.log('[notice] 文本或挂载文件缺失：')
    d.missing.forEach((m) => console.log(`         ${m}`))
    return 2
  }
  if (d.broken) {
    console.log(`[notice] ${NOTICE_TEXT} 不是合法 JSON`)
    return 2
  }
  if (!(d.hold >= NOTICE_MIN_HOLD)) {
    console.log(`[notice] 停留时长 ${d.hold}ms 低于下限 ${NOTICE_MIN_HOLD}ms`)
    return 2
  }
  if (!(d.manualHold >= NOTICE_MIN_MANUAL)) {
    console.log(`[notice] 手动停留时长 ${d.manualHold}ms 低于下限 ${NOTICE_MIN_MANUAL}ms`)
    return 2
  }
  if (d.items < NOTICE_MIN_ITEMS) {
    console.log(`[notice] 条目数 ${d.items} 少于 ${NOTICE_MIN_ITEMS}`)
    return 2
  }
  if (d.repo !== NOTICE_REPO_PIN) {
    console.log('[notice] 渠道地址与署名不一致')
    return 2
  }
  const next = placeMarks(sealSource(d), '.ts', NOTICE_SEAL, MARK_SHORT)
  fs.writeFileSync(path.join(ROOT, NOTICE_SEAL), next, 'utf8')
  const after = noticeDigests(ROOT)
  updateManifest(after)
  console.log(`[notice] 已生成 ${NOTICE_SEAL}`)
  console.log(`[notice] 文本 ${sha(after.text)}  时长 ${after.hold}ms / ${after.manualHold}ms  条目 ${after.items}`)
  console.log(`[notice] 视图 ${sha(after.view)}`)
  console.log(`[notice] 兜底 ${sha(after.guard)}`)
  return 0
}

function diff () {
  const problems = noticeProblems(ROOT, NOTICE_REPO_PIN)
  const d = noticeDigests(ROOT)
  const sealNow = readSeal(ROOT)
  console.log(`[notice] 文本 ${sha(d.text)} / 封存 ${sha(sealNow.text)}`)
  console.log(`[notice] 视图 ${sha(d.view)} / 封存 ${sha(sealNow.view)}`)
  console.log(`[notice] 兜底 ${sha(d.guard)} / 封存 ${sha(sealNow.guard)}`)
  console.log(`[notice] 手动时长 ${d.manualHold}ms / 封存 ${sealNow.manual}ms`)
  if (!problems.length) {
    console.log('[notice] 一致')
    return 0
  }
  problems.forEach((p) => console.log(`[notice] 漂移：${p}`))
  return 2
}

function info () {
  const d = noticeDigests(ROOT)
  const sealNow = readSeal(ROOT)
  console.log(`[notice] 文本 ${NOTICE_TEXT}`)
  console.log(`[notice] 摘要 ${d.text}`)
  console.log(`[notice] 时长 ${d.hold}ms / ${d.manualHold}ms  ·  条目 ${d.items}  ·  渠道 ${d.repo}`)
  console.log(`[notice] 封存 ${sealNow.present ? '有' : '无'}  ·  ${NOTICE_SEAL}`)
  console.log('[notice] 视图 ' + NOTICE_VIEW)
  console.log('[notice] 兜底 ' + NOTICE_GUARD)
  return 0
}

const table = { seal, diff, info }
const fn = table[cmd]
if (!fn) {
  console.log(`[notice] 未知命令 ${cmd}：seal / diff / info`)
  process.exit(2)
}
process.exit(fn() ?? 0)
