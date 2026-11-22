#!/usr/bin/env node
import { LepaoClient, loadSession } from '../server/lib/lp-client.mjs'
import { buildRunTrack } from '../server/lib/runtrack.mjs'
import { meters, analyzeStats } from '../server/lib/sim.mjs'
import { createJob, jobs } from '../server/lib/submit.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k)
  return i > 0 ? process.argv[i + 1] : d
}
const dry = process.argv.includes('--dry')
const targetKm = Number(arg('target', 1.6))

const s = loadSession('data/session.json')
if (!s?.token) { console.error('没有会话：先 node scripts/sync-device.mjs 或 node scripts/import-har.mjs <har> --save'); process.exit(1) }

const c = new LepaoClient(s)
const me = await c.plain('User/User')
if (me.status !== 1) { console.error('鉴权失败', me.status, me.info); process.exit(1) }
console.log(`鉴权 ok：${me.dec?.name || s.uid}`)

const br = await c.keyed('Run2/beforeRunV260')
if (br.status !== 1) { console.error('beforeRun 失败', br.status, br.info); process.exit(1) }
const d = br.dec
const tr = d.time_rule_arr?.[0] || {}
const rules = {
  zoneId: String(d.run_zone_id || '1'),
  zoneName: d.run_zone_name,
  minDistanceKm: Number(tr.min_distance || 1.5),
  maxDistanceKm: Number(tr.max_distance || 10),
  minPaceSec: Number(tr.min_pace || 540),
  maxPaceSec: Number(tr.max_pace || 180),
  minLogNum: Number(tr.min_log_num || 2),
  pointNumOnline: Number(tr.point_num_online || 2),
  termId: String(d.term_id || ''),
}
console.log(`跑区 ${rules.zoneName} / 规则 ${rules.minDistanceKm}km 配速 ${rules.maxPaceSec}~${rules.minPaceSec}s`)

const zp = await c.zonePoints(rules.zoneId)
const cps = (zp.dec?.point_list || []).map((x) => {
  const [lat, lng] = String(x.jingwei || '0,0').split(',').map(Number)
  return { id: String(x.point_id ?? x.id ?? ''), name: String(x.name ?? ''), lat, lng }
})
if (cps.length < 2) { console.error('打卡点不足'); process.exit(1) }

let pair = null
for (let i = 0; i < cps.length && !pair; i++) {
  for (let j = i + 1; j < cps.length; j++) {
    const dist = meters([cps[i].lat, cps[i].lng], [cps[j].lat, cps[j].lng])
    if (dist > 500 && dist < 1400) { pair = [cps[i], cps[j]]; break }
  }
}
if (!pair && cps.length >= 2) pair = [cps[0], cps[1]]
const [a, b] = pair
const path = [
  [a.lat + 0.0011, a.lng + 0.0014],
  [a.lat, a.lng],
  [(a.lat + b.lat) / 2 + 0.0009, (a.lng + b.lng) / 2],
  [b.lat, b.lng],
  [b.lat - 0.0018, b.lng - 0.0021],
  [a.lat - 0.0013, a.lng + 0.0016],
  [a.lat, a.lng],
]
const built0 = buildRunTrack({
  path, checkpoints: cps, mustHit: pair.map((x) => x.id),
  targetKm, speed: 3.1, intervalMs: 1800, noisePct: 8, dwellFrames: 6,
})
let built = built0
for (let i = 0; i < 4; i++) {
  const sm = analyzeStats(built.frames, 1800)
  if (sm.distanceKm >= rules.minDistanceKm + 0.12) break
  const factor = (rules.minDistanceKm + 0.25) / Math.max(0.5, sm.distanceKm)
  const next = built.targetKmUsed ? built.targetKmUsed : targetKm
  const grown = Math.min(10, Math.max(targetKm, next * factor))
  console.log(`里程校准：去噪后 ${sm.distanceKm.toFixed(2)} km 不够，target ${targetKm} → ${grown.toFixed(2)} km 重建`)
  built = buildRunTrack({
    path, checkpoints: cps, mustHit: pair.map((x) => x.id),
    targetKm: grown, speed: 3.1, intervalMs: 1800, noisePct: 8, dwellFrames: 6,
  })
}
const frames = built.frames
const pins = pair.map((cp) => {
  let best = Infinity
  let idx = -1
  frames.forEach((f, i) => { const dd = meters([f.a, f.o], [cp.lat, cp.lng]); if (dd < best) { best = dd; idx = i } })
  return { cp, dist: best, idx }
})
for (const p of pins) console.log(`打卡点 ${p.cp.id} ${p.cp.name} 离轨迹最近 ${p.dist.toFixed(2)} m`)
if (pins.some((p) => p.dist > 2)) { console.error('打卡点没被轨迹踩到，先调路线'); process.exit(2) }
console.log(`轨迹 ${frames.length} 帧 / ${built.stats.distanceKm.toFixed(2)} km / ${Math.round(built.stats.durationSec)} s`)

if (dry) { console.log('--dry：不提交'); process.exit(0) }

const checkpoints = cps.map((cp) => {
  let best = Infinity
  frames.forEach((f) => { const dd = meters([f.a, f.o], [cp.lat, cp.lng]); if (dd < best) best = dd })
  return { ...cp, hit: best <= 2, distM: +best.toFixed(2) }
})

const id = createJob({
  points: frames,
  checkpoints,
  meta: {
    intervalMs: 1800,
    rules,
    pinned: pair.map((x) => x.id),
    reportCount: 6,
    startAt: '',
    previewKm: built.stats.distanceKm,
  },
})
console.log('\n提交任务', id, '已启动，等待链路跑完…\n')

const job = jobs.get(id)
for (let i = 0; i < 120; i++) {
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  await new Promise((r) => setTimeout(r, 500))
  if (job.state !== 'running') break
}

for (const st of job.steps) {
  const flag = st.state === 'ok' ? '✓' : st.state === 'skip' ? '-' : '✗'
  console.log(`${flag} ${st.label}  (${st.ms}ms)`)
  console.log(`   ${st.detail}`)
}
console.log('\n结果：', job.state, JSON.stringify(job.verdict))
process.exit(job.state === 'done' ? 0 : 1)
