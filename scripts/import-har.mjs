#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataRoot } from '../server/lib/paths.mjs'
import { rememberFingerprint } from './lib/auth.mjs'

const REQ_KEY = Buffer.from('goMEzJ1pDpncNHb9')
const REQ_IV = Buffer.from('ZUrAS2lUidjyY2gK')
const RES_KEY = Buffer.from('Wet2C8d34f62ndi3')
const RES_IV = Buffer.from('K6iv85jBD8jgf32D')

const decReq = (b64) => {
  const d = crypto.createDecipheriv('aes-128-cbc', REQ_KEY, REQ_IV)
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8')
}

function paramsOf (entry) {
  const url = String(entry.request?.url || '')
  if (!url.includes('lptiyu')) return null
  const text = String(entry.request?.postData?.text || '')
  if (!text) return null
  const form = new URLSearchParams(text)
  if (form.has('key')) {
    try { return JSON.parse(decReq(form.get('key'))) } catch { return null }
  }
  const o = {}
  for (const [k, v] of form) o[k] = v
  return Object.keys(o).some((k) => k === 'token' || k === 'uid') ? o : null
}

const argFile = process.argv[2]
if (!argFile) {
  console.error('用法: node scripts/import-har.mjs <file.har> [--save]')
  process.exit(2)
}
const save = process.argv.includes('--save')
const dry = process.argv.includes('--dry')

const har = JSON.parse(fs.readFileSync(argFile, 'utf8'))
const entries = har?.log?.entries || []
const seen = []
for (const e of entries) {
  const p = paramsOf(e)
  if (!p || !p.token || !p.uid) continue
  seen.push({
    mod: String(e.request.url).split('/v3/api.php/')[1] || '',
    params: p,
    ts: Number(p.timestamp || 0),

  })
}

if (!seen.length) {
  console.error(`HAR 里没有乐跑请求（共 ${entries.length} 条）。确认抓包时勾选了 api2.lptiyu.com。`)
  process.exit(1)
}

seen.sort((a, b) => b.ts - a.ts)
const live = seen[0]
const p = live.params

const withLp54 = seen.find((x) => x.params.lp54 !== undefined || x.params.lpd3 !== undefined)
const incoming = {
  token: String(p.token || ''),
  uid: Number(p.uid) || p.uid,
  school_id: Number(p.school_id) || p.school_id,
  student_num: String(p.student_num || ''),
  mobileModel: String(p.mobileModel || '').trim(),
  mobileDeviceId: String(p.mobileDeviceId ?? '').trim(),
  mobileOsVersion: String(p.mobileOsVersion ?? '').trim(),
  lp54: withLp54
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    ? String(withLp54.params.lp54 ?? withLp54.params.lpd3)
    : undefined,
}

const mask = (v) => {
  const s = String(v ?? '')
  if (!s) return "''（空）"
  return s.length <= 12 ? s : s.slice(0, 8) + '…' + s.slice(-4)
}

console.log(`HAR: ${path.basename(argFile)}  （${entries.length} 条，其中乐跑请求 ${seen.length} 条）`)
console.log(`最新一条来自 ${live.mod}  timestamp=${live.ts}（${live.ts ? new Date(live.ts * 1000).toLocaleString('zh-CN') : '-'}）\n`)
console.log('  账号      uid=', incoming.uid, ' 学号=', incoming.student_num, ' school_id=', incoming.school_id)
console.log('  token     ', mask(incoming.token))
console.log('  机型      ', incoming.mobileModel || '(缺)')
console.log('  系统版本  ', incoming.mobileOsVersion || '(缺)')
console.log('  设备 id   ', incoming.mobileDeviceId || "(缺 —— 4.3.3 必须非空，空串会让服务端回 0 系统错误)")
console.log('  lp54      ', incoming.lp54 === undefined ? '(这条没带)' : mask(incoming.lp54))

const missing = ['mobileModel', 'mobileDeviceId', 'mobileOsVersion'].filter((k) => !incoming[k])
if (missing.length) console.log(`\n⚠ 抓包里缺 ${missing.join(' / ')}：用明文通道的任一请求（User/User）就有这三项`)

if (!save || dry) {
  console.log('\n（未写入。加 --save 才会更新 data/session.json）')
  process.exit(0)
}

const FILE = path.join(dataRoot(), 'data', 'session.json')
let disk = {}
try { disk = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')) } catch { disk = {} }
const merged = { ...disk }
if (disk.token && incoming.token && String(disk.token) !== String(incoming.token)) {
  delete merged.lp54
  delete merged.lpd3
}
for (const [k, v] of Object.entries(incoming)) {
  if (v === undefined || v === '') continue
  merged[k] = v
}
merged.saved_at = new Date().toISOString()
merged.source = `har:${path.basename(argFile)}`
fs.mkdirSync(path.dirname(FILE), { recursive: true })
fs.writeFileSync(FILE, JSON.stringify(merged, null, 2))
rememberFingerprint(merged)
console.log(`\n已写入 ${FILE}`)
console.log('指纹三项：', merged.mobileModel, '/', mask(merged.mobileDeviceId), '/', merged.mobileOsVersion)
