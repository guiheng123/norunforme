import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import {
  makeClient,
  haversine,
  trackLength,
  collectCheckpoints,
} from './lib/track-analysis.mjs'

const S = JSON.parse(readFileSync('creds.json', 'utf8'))
const call = makeClient(S)

const args = process.argv.slice(2)
function arg(name, def) {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
}

const startArg = arg('start', null)
const targetKm = Number(arg('target', 0))

function nearestNeighbor(points, start) {
  const remaining = [...points]
  const route = [start]
  let cur = start
  while (remaining.length) {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(cur.lat, cur.lng, remaining[i].lat, remaining[i].lng)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    cur = remaining.splice(best, 1)[0]
    route.push(cur)
  }
  return route
}

function routeLength(route) {
  let d = 0
  for (let i = 1; i < route.length; i++) {
    d += haversine(route[i - 1].lat, route[i - 1].lng, route[i].lat, route[i].lng)
  }
  return d
}

function twoOpt(route, maxIter = 500) {
  let best = [...route]
  let bestLen = routeLength(best)
  let improved = true
  let iter = 0
  while (improved && iter < maxIter) {
    improved = false
    iter++
    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)]
        const len = routeLength(cand)
        if (len < bestLen - 0.5) {
          best = cand
          bestLen = len
          improved = true
        }
      }
    }
  }
  return { route: best, length: bestLen }
}

console.log('=== 打卡点路线规划 ===\n')

const tl = await call('WpRun/getTermList')
if (tl.status !== 1) {
  console.error('获取学期失败：', tl.info)
  process.exit(1)
}
const termId = tl.data[0].term_id
console.log(`学期：${tl.data[0].term_name}`)

const allRecords = []
for (let page = 1; page <= 5; page++) {
  const r = await call('WpRun/getTermRunRecord', { term_id: termId, page })
  if (r.status !== 1 || !r.data?.list?.length) break
  allRecords.push(...r.data.list)
  if (r.data.list.length < 10) break
}
console.log(`历史记录：${allRecords.length} 条`)

for (const t of (tl.data ?? []).slice(1, 4)) {
  for (let page = 1; page <= 2; page++) {
    const r = await call('WpRun/getTermRunRecord', { term_id: t.term_id, page })
    if (r.status !== 1 || !r.data?.list?.length) break
    allRecords.push(...r.data.list)
    if (r.data.list.length < 10) break
  }
}
console.log(`含往期共：${allRecords.length} 条记录待分析`)

console.log('正在聚合打卡点…')
const checkpoints = await collectCheckpoints(call, allRecords.slice(0, 40))
console.log(`聚合到 ${checkpoints.length} 个打卡点\n`)

if (checkpoints.length === 0) {
  console.error('未找到打卡点。可能这些记录都是「自由打卡」类型。')
  process.exit(1)
}

const merged = []
for (const cp of checkpoints) {
  const dup = merged.find(
    (m) => haversine(m.lat, m.lng, cp.lat, cp.lng) < 25,
  )
  if (dup) {
    dup.seen += cp.seen
    dup.ids.push(cp.id)
  } else {
    merged.push({ ...cp, ids: [cp.id] })
  }
}

console.log('=== 打卡点列表（去重后）===')
merged.forEach((p, i) => {
  console.log(
    `  ${String(i + 1).padStart(2)}. id=${p.ids.join('/')}  lat=${p.lat.toFixed(6)}  lng=${p.lng.toFixed(6)}  命中${p.seen}次`,
  )
})
console.log()

let start
if (startArg) {
  const [lat, lng] = startArg.split(',').map(Number)
  start = { lat, lng, name: '指定起点' }
} else if (allRecords[0]) {
  const det = await call('Run/recordDetailV270', {
    record_id: allRecords[0].id,
    year_num: new Date().getFullYear(),
  })
  start = { lat: merged[0].lat, lng: merged[0].lng, name: '起点(1号打卡点)' }
} else {
  start = { lat: merged[0].lat, lng: merged[0].lng, name: '起点' }
}

const nn = nearestNeighbor(merged, start)
const opt = twoOpt(nn)

const closed = [...opt.route, opt.route[0]]
const closedLen = routeLength(closed)

console.log('=== 规划结果 ===')
console.log(`打卡点数   ：${merged.length}`)
console.log(`开放路线   ：${(opt.length / 1000).toFixed(2)} km`)
console.log(`闭合回路   ：${(closedLen / 1000).toFixed(2)} km`)
if (targetKm > 0) {
  const laps = Math.ceil(targetKm / (closedLen / 1000))
  console.log(`目标 ${targetKm} km → 需跑 ${laps} 圈，合计 ${((closedLen / 1000) * laps).toFixed(2)} km`)
}
console.log()

console.log('=== 路线顺序 ===')
closed.forEach((p, i) => {
  const tag = i === 0 ? '起点/终点' : i === closed.length - 1 ? '回到起点' : `第 ${i} 站`
  console.log(`  ${tag.padEnd(10)} lat=${p.lat.toFixed(6)}  lng=${p.lng.toFixed(6)}  id=${p.ids?.join('/') ?? ''}`)
})

const result = {
  generatedAt: new Date().toISOString(),
  school: tl.data[0]?.term_name ?? '',
  checkpoints: merged.map((p) => ({ id: p.ids, lat: p.lat, lng: p.lng, seen: p.seen })),
  route: closed.map((p) => ({ lat: p.lat, lng: p.lng })),
  openLengthKm: +(opt.length / 1000).toFixed(2),
  closedLengthKm: +(closedLen / 1000).toFixed(2),
  targetKm: targetKm || null,
  laps: targetKm > 0 ? Math.ceil(targetKm / (closedLen / 1000)) : null,
}

writeFileSync('route-plan.json', JSON.stringify(result, null, 2))
console.log('\n已保存到 route-plan.json')
console.log('提示：把 route-plan.json 拖到 Web 的「跑区」页即可在地图上查看。')
