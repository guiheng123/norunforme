import { readFileSync } from 'node:fs'
import { buildPath } from './lib/route.mjs'
import { generateRun, DEFAULTS } from './lib/gen.mjs'
import { analyzeTrack, diagnose } from './lib/track-analysis.mjs'
import { rng } from './lib/geo.mjs'

const real = JSON.parse(readFileSync('run-analysis.json', 'utf8')).map((r) => r.analysis)
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : ' - ')

const plan = JSON.parse(readFileSync('route-plan.json', 'utf8'))
const checkpoints = plan.checkpoints.map((c, i) => ({ id: String(i + 1), lat: c.lat, lng: c.lng }))

const overrides = JSON.parse(process.argv[2] ?? '{}')
const N = Number(process.argv[3] ?? 12)
const pace = Number(process.argv[4] ?? 330)
const targetKm = Number(process.argv[5] ?? 2.0)

const sims = []
for (let k = 0; k < N; k++) {
  const seed = 1000 + k * 37
  const path = buildPath({ checkpoints, mode: 'free', r: rng(seed) })
  const run = generateRun({
    route: path.points,
    checkpoints,
    targetKm,
    seed,
    paceSecPerKm: pace,
    sensorHz: 2,
    ...overrides,
  })
  const a = analyzeTrack(run.points, { time: run.meta.duration, distance: run.meta.distanceKm })
  const d = diagnose(a, 0)
  sims.push({ a, score: d.score, hits: run.meta.hitCount, n: run.points.length, dur: run.meta.duration })
}

const table = [
  ['轨迹点数', mean(real.map((r) => r.points)), mean(sims.map((s) => s.n))],
  ['用时(s)', mean(real.map((r) => r.duration)), mean(sims.map((s) => s.dur))],
  ['距离(km)', mean(real.map((r) => r.distance)), mean(sims.map((s) => s.a.distance))],
  ['平均速度', mean(real.map((r) => r.speed.avg)), mean(sims.map((s) => s.a.speed.avg))],
  ['最高速度', mean(real.map((r) => r.speed.max)), mean(sims.map((s) => s.a.speed.max))],
  ['速度标准差', mean(real.map((r) => r.speed.std)), mean(sims.map((s) => s.a.speed.std))],
  ['最大加速度', mean(real.map((r) => r.maxAccel)), mean(sims.map((s) => s.a.maxAccel))],
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  ['位移自相关', mean(real.map((r) => r.autocorr)), mean(sims.map((s) => s.a.autocorr))],
  ['速度自相关', mean(real.map((r) => r.speedAutocorr)), mean(sims.map((s) => s.a.speedAutocorr))],
  ['停顿占比%', mean(real.map((r) => r.stoppedRatio)), mean(sims.map((s) => s.a.stoppedRatio))],
  ['GPS噪声%', mean(real.map((r) => r.gpsNoisePct)), mean(sims.map((s) => s.a.gpsNoisePct))],
  ['诊断均分', 100, mean(sims.map((s) => s.score))],
  ['打卡命中', mean(real.map((r) => r.checkpointHits)), mean(sims.map((s) => s.hits))],
]

console.log(`参数：${JSON.stringify(overrides)}  ×${N}  pace=${pace}s  target=${targetKm}km\n`)
console.log('指标            真实均值    模拟均值')
for (const [name, a, b] of table) console.log(`${name.padEnd(14)}  ${fmt(a, 2).padStart(9)}  ${fmt(b, 2).padStart(9)}`)

const noise = sims.map((s) => s.a.gpsNoisePct)
console.log(`\n模拟 GPS 噪声范围 ${Math.min(...noise).toFixed(1)}% ~ ${Math.max(...noise).toFixed(1)}%`)
console.log(`模拟自相关范围 ${Math.min(...sims.map((s) => s.a.autocorr)).toFixed(2)} ~ ${Math.max(...sims.map((s) => s.a.autocorr)).toFixed(2)}`)
console.log(`模拟最高速度范围 ${Math.min(...sims.map((s) => s.a.speed.max)).toFixed(2)} ~ ${Math.max(...sims.map((s) => s.a.speed.max)).toFixed(2)}`)
console.log(`诊断分分布 ${[...new Set(sims.map((s) => s.score))].join(', ')}`)
