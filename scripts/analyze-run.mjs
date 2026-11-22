import { readFileSync, writeFileSync } from 'node:fs'
import {
  makeClient,
  fetchTrack,
  analyzeTrack,
  diagnose,
  trackLength,
} from './lib/track-analysis.mjs'

const S = JSON.parse(readFileSync('creds.json', 'utf8'))
const call = makeClient(S)

const args = process.argv.slice(2)
const doAll = args.includes('--all')
const idArg = args.includes('--id') ? args[args.indexOf('--id') + 1] : null

const tl = await call('WpRun/getTermList')
const rec = await call('WpRun/getTermRunRecord', { term_id: tl.data[0].term_id, page: 1 })

if (rec.status !== 1) {
  console.error('获取记录失败：', rec.info)
  process.exit(1)
}

let targets = rec.data.list
if (idArg) targets = targets.filter((r) => String(r.id) === String(idArg))
else if (!doAll) targets = targets.slice(0, 1)

console.log(`=== 配速与抖动分析 ===\n`)

const results = []

for (const r of targets) {
  const det = await call('Run/recordDetailV270', {
    record_id: r.id,
    year_num: new Date().getFullYear(),
  })
  if (det.status !== 1 || !det.data?.file) {
    console.log(`记录 ${r.id}：无轨迹文件，跳过`)
    continue
  }

  const d = det.data
  const track = await fetchTrack(d.file)
  if (!track) {
    console.log(`记录 ${r.id}：轨迹解密失败`)
    continue
  }

  const a = analyzeTrack(track, { time: d.time, distance: d.distance })
  const diag = diagnose(a, Number(d.step_num) || 0)

  console.log(`─── 记录 ${r.id} ─────────────────────`)
  console.log(`  时间    ：${new Date(Number(d.start_time) * 1000).toLocaleString('zh-CN')}`)
  console.log(`  跑区    ：${d.run_zone_name}`)
  console.log(`  距离    ：${a.distance} km（服务端记录 ${d.distance} km）`)
  console.log(`  用时    ：${Math.floor(a.duration / 60)}分${a.duration % 60}秒`)
  console.log(`  配速    ：${a.pace}`)
  console.log(`  速度    ：平均 ${a.speed.avg} / 最大 ${a.speed.max} / 标准差 ${a.speed.std} m/s`)
  console.log(`  加速度  ：最大 ${a.maxAccel} m/s²`)
  console.log(`  连续性  ：lag-1 自相关 ${a.autocorr}`)
  console.log(`  停顿    ：${a.stoppedRatio}% 的点速度 < 0.3 m/s`)
  console.log(`  打卡点  ：命中 ${a.checkpointHits} 个`)
  console.log(`  轨迹点  ：${a.points} 个`)
  console.log()
  console.log(`  分段速度（10 段）：${a.segments.join(' → ')}`)
  console.log()
  console.log(`  真实性诊断：${diag.score} 分 — ${diag.verdict}`)
  for (const c of diag.checks) {
    console.log(`    ${c.pass ? '✅' : '⚠️ '} ${c.name.padEnd(8)} ${c.detail}`)
  }
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  console.log()

  results.push({
    id: r.id,
    startTime: Number(d.start_time),
    zone: d.run_zone_name,
    analysis: a,
    diagnosis: diag,
    track: track.map((p) => ({ lat: p.a, lng: p.o, s: p.s, p: p.p })),
  })
}

if (results.length === 0) {
  console.error('没有可分析的记录')
  process.exit(1)
}

if (results.length > 1) {
  const avgPace =
    results.reduce((s, r) => s + (r.analysis.duration / r.analysis.distance), 0) / results.length
  console.log('=== 汇总 ===')
  console.log(`  分析记录数：${results.length}`)
  console.log(`  平均配速  ：${Math.floor(avgPace / 60)}'${String(Math.round(avgPace % 60)).padStart(2, '0')}"`)
  console.log(`  平均诊断分：${Math.round(results.reduce((s, r) => s + r.diagnosis.score, 0) / results.length)}`)
}

writeFileSync('run-analysis.json', JSON.stringify(results, null, 2))
console.log('\n已保存到 run-analysis.json')
