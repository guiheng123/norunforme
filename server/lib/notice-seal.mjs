import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import { SIG_REPO } from './attest.mjs'

export const NOTICE_MIN_HOLD = 5000
export const NOTICE_MIN_MANUAL = 10000
export const NOTICE_MIN_ITEMS = 10
export const NOTICE_REPO_PIN = SIG_REPO

export const NOTICE_TEXT = 'web/src/lib/notice.canonical.json'
export const NOTICE_VIEW = 'web/src/components/NoticeModal.vue'
export const NOTICE_GUARD = 'web/src/lib/notice-guard.ts'
export const NOTICE_SEAL = 'web/src/lib/notice-fallback.ts'

const ALL = /[\u200b-\u200d\u2060-\u2063\ufeff]/g

export const stripAll = (text) => String(text ?? '').replace(ALL, '')
export const digestText = (text) => crypto.createHash('sha256').update(stripAll(text)).digest('hex')

function readFile (root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8')
  } catch {
    return null
  }
}

export function noticeDigests (root) {
  const missing = []
  const raw = {}
  for (const rel of [NOTICE_TEXT, NOTICE_VIEW, NOTICE_GUARD]) {
    raw[rel] = readFile(root, rel)
    if (raw[rel] === null) missing.push(rel)
  }

  const text = raw[NOTICE_TEXT]
  let canon = null
  if (text !== null) {
    try {
      canon = JSON.parse(stripAll(text))
    } catch {
      canon = null
    }
  }

  const items = canon
    ? (Array.isArray(canon.disclaimer?.items) ? canon.disclaimer.items.length : 0) +
      (Array.isArray(canon.prohibited?.items) ? canon.prohibited.items.length : 0)
    : 0

  return {
    missing,
    broken: text !== null && canon === null,
    text: text === null ? null : digestText(text),
    view: raw[NOTICE_VIEW] === null ? null : digestText(raw[NOTICE_VIEW]),
    guard: raw[NOTICE_GUARD] === null ? null : digestText(raw[NOTICE_GUARD]),
    hold: Number(canon?.holdMs) || 0,
    manualHold: Number(canon?.manualHoldMs) || 0,
    items,
    repo: typeof canon?.repo === 'string' ? canon.repo : '',
    owner: typeof canon?.owner === 'string' ? canon.owner : '',
    autoHint: typeof canon?.autoHint === 'string' ? canon.autoHint : '',
    canon,
  }
}

//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
export function readSeal (root) {
  const t = readFile(root, NOTICE_SEAL)
  const pick = (re) => (t?.match(re) || [])[1] || null
  return {
    present: t !== null,
    text: pick(/NOTICE_TEXT_SHA\s*=\s*'([0-9a-f]{64})'/),
    view: pick(/NOTICE_VIEW_SHA\s*=\s*'([0-9a-f]{64})'/),
    guard: pick(/NOTICE_GUARD_SHA\s*=\s*'([0-9a-f]{64})'/),
    hold: Number(pick(/NOTICE_HOLD_MS\s*=\s*(\d+)/) || 0),
    manual: Number(pick(/NOTICE_MANUAL_MS\s*=\s*(\d+)/) || 0),
    hasFallback: /export\s+const\s+NOTICE_FALLBACK\s*=/.test(String(t ?? '')),
  }
}

export function sealSource (d) {
  const c = d.canon || {}
  const body = JSON.stringify({
    title: c.title ?? '',
    repo: c.repo ?? '',
    owner: c.owner ?? '',
    ack: c.ack ?? '',
    autoHint: c.autoHint ?? '',
    manual: c.manual ?? { ack: '', close: '', note: '' },
    disclaimer: c.disclaimer ?? { head: '', items: [] },
    source: c.source ?? { head: '', hint: '' },
    prohibited: c.prohibited ?? { head: '', items: [], hint: '' },
  }, null, 2)

  return [
    `export const NOTICE_TEXT_SHA = '${d.text}'`,
    `export const NOTICE_VIEW_SHA = '${d.view}'`,
    `export const NOTICE_GUARD_SHA = '${d.guard}'`,
    `export const NOTICE_HOLD_MS = ${d.hold}`,
    `export const NOTICE_MANUAL_MS = ${d.manualHold}`,
    `export const NOTICE_FALLBACK = ${body} as const`,
    '',
  ].join('\n')
}

export function noticeProblems (root, expectRepo) {
  const d = noticeDigests(root)
  const seal = readSeal(root)
  const out = []

  for (const rel of d.missing) out.push(`notice-missing:${rel}`)
  if (d.broken) out.push('notice-text-unreadable')
  if (!seal.present) out.push('notice-seal-missing')
  if (seal.present && !seal.hasFallback) out.push('notice-seal-incomplete')

  if (seal.present) {
    if (seal.text !== d.text) out.push('notice-text-drift')
    if (seal.view !== d.view) out.push('notice-view-drift')
    if (seal.guard !== d.guard) out.push('notice-guard-drift')
    if (seal.hold !== d.hold) out.push('notice-hold-drift')
    if (seal.manual !== d.manualHold) out.push('notice-manual-drift')
  }
  if (expectRepo && d.repo !== expectRepo) out.push('notice-repo-drift')
  if (d.items < 10) out.push('notice-items-short')
  if (d.manualHold < NOTICE_MIN_MANUAL) out.push('notice-manual-short')

  return out
}
