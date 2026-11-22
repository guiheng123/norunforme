import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { makeClient, haversine } from './lib/track-analysis.mjs'
import { installExitShim } from './lib/exit.mjs'

installExitShim()

const argv = process.argv.slice(2)
const arg = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d) : null
}

const maxTerms = Number(arg('terms', 3))
const maxRecords = Number(arg('max-records', 60))
const mergeFile = arg('merge', null)
const outFile = arg('out', 'checkpoints.json')
const DEDUP_M = Number(arg('dedup', 25))

const S = JSON.parse(readFileSync('creds.json', 'utf8'))
const call = makeClient(S)

const fail = (msg, code = 3) => {
  console.log(msg)
  process.exit(code)
}

console.log('=== 打卡点自动获取 ===\n')

const zone = await call('User/myZone')
if (zone.status !== 1) fail(`鉴权失败：status=${zone.status} ${zone.info}\n请更新 creds.json 里的 token（手机端抓包最省事）。`)
const nick = zone.data?.user_info?.nick_name ?? ''
const school = zone.data?.user_info?.school_name ?? ''

const tl = await call('WpRun/getTermList')
if (tl.status !== 1 || !Array.isArray(tl.data)) fail(`取学期失败：${tl.info}`)
const terms = tl.data.slice(0, maxTerms)
console.log(`账号：${nick} ${school ? `｜ ${school}` : ''}`)
console.log(`学期：${terms.map((t) => t.term_name).join(' / ')}\n`)

const records = []
for (const t of terms) {
  for (let page = 1; page <= 6; page++) {
    const r = await call('WpRun/getTermRunRecord', { term_id: t.term_id, page })
    if (r.status !== 1 || !r.data?.list?.length) break
    records.push(...r.data.list)
    if (r.data.list.length < 10) break
    if (records.length >= maxRecords) break
  }
  if (records.length >= maxRecords) break
}
console.log(`历史记录：${records.length} 条`)

const zoneCandidates = [
  'Run2/getRunZoneV270',
  'Run/getRunZoneV270',
  'WpRun/getRunZone',
  'Run/getRunZone',
  'Run2/getZonePointList',
  'Run/getZonePointList',
  'WpRun/getPointList',
]
const zoneInfo = []
for (const mod of zoneCandidates) {
  const r = await call(mod, { year_num: new Date().getFullYear() })
  if (r.status === 1 && r.data) {
    console.log(`  ✅ 跑区接口命中：${mod}`)
    zoneInfo.push({ mod, data: r.data })
    break
  }
}

const byId = new Map()
let scanned = 0
for (const rec of records.slice(0, maxRecords)) {
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  const det = await call('Run/recordDetailV270', {
    record_id: rec.id,
    year_num: new Date().getFullYear(),
  })
  scanned++
  if (det.status !== 1) continue
  for (const p of det.data?.point_list ?? []) {
    const id = String(p.point_id ?? p.id)
    const lat = Number(p.latitude ?? p.lat)
    const lng = Number(p.longtitude ?? p.longitude ?? p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const prev = byId.get(id)
    if (prev) {
      prev.seen++
      prev.hits.push({ recordId: rec.id, at: det.data?.start_time ?? null })
    } else
      byId.set(id, {
        id,
        lat,
        lng,
        index: Number(p.point_index ?? 0),
        seen: 1,
        name: p.point_name ?? p.name ?? null,
        hits: [{ recordId: rec.id, at: det.data?.start_time ?? null }],
      })
  }
  if (scanned % 10 === 0) process.stdout.write(`  已扫 ${scanned}/${Math.min(records.length, maxRecords)}\r`)
}
console.log(`\n扫完 ${scanned} 条记录，原始打卡点 ${byId.size} 个`)

const merged = []
for (const cp of byId.values()) {
  const dup = merged.find((m) => haversine(m.lat, m.lng, cp.lat, cp.lng) < DEDUP_M)
  if (dup) {
    dup.ids.push(cp.id)
    dup.seen += cp.seen
    dup.hits.push(...cp.hits)
  } else merged.push({ ids: [cp.id], lat: cp.lat, lng: cp.lng, index: cp.index, seen: cp.seen, name: cp.name, hits: [...cp.hits] })
}

if (mergeFile && existsSync(mergeFile)) {
  const j = JSON.parse(readFileSync(mergeFile, 'utf8'))
  for (const c of j.checkpoints ?? []) {
    const lat = +c.lat
    const lng = +c.lng
    const dup = merged.find((m) => haversine(m.lat, m.lng, lat, lng) < DEDUP_M)
    if (dup) dup.ids.push(...(Array.isArray(c.id) ? c.id : [c.id]))
    else merged.push({ ids: Array.isArray(c.id) ? c.id : [c.id], lat, lng, index: 0, seen: c.seen ?? 0, name: c.name ?? null, hits: [] })
  }
  console.log(`并入 ${mergeFile}，现有 ${merged.length} 个点`)
}

const checkpoints = merged
  .sort((a, b) => b.seen - a.seen)
  .map((m, i) => ({
    no: i + 1,
    id: m.ids.join('/'),
    ids: m.ids,
    lat: +m.lat.toFixed(6),
    lng: +m.lng.toFixed(6),
    seen: m.seen,
    name: m.name,
  }))

const payload = {
  generatedAt: new Date().toISOString(),
  account: { uid: S.uid, nick, school, school_id: S.school_id },
  terms: terms.map((t) => ({ id: t.term_id, name: t.term_name })),
  zones: zoneInfo.map((z) => ({ mod: z.mod, summary: summarize(z.data) })),
  checkpoints,
}

writeFileSync(outFile, JSON.stringify(payload, null, 2))

console.log(`\n=== 打卡点（${checkpoints.length} 个，已按命中次数排序）===`)
for (const c of checkpoints)
  console.log(`  ${String(c.no).padStart(2)}. id=${String(c.id).padEnd(9)} lat=${c.lat.toFixed(6)} lng=${c.lng.toFixed(6)} 命中${c.seen}次`)
console.log(`\n已写入 ${outFile}`)

function summarize(data) {
  if (Array.isArray(data)) return { count: data.length, sample: data[0] ?? null }
  return { keys: Object.keys(data ?? {}).slice(0, 12) }
}
