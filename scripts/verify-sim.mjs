import { readFileSync } from 'node:fs'
import { buildPath } from './lib/route.mjs'
import { generateRun } from './lib/gen.mjs'
import { packTrack, unpackTrack } from './lib/trackfile.mjs'
import { analyzeTrack, diagnose } from './lib/track-analysis.mjs'
import { rng, haversine } from './lib/geo.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
const runs = Number(arg('runs', 20))
const paceArg = String(arg('pace', '5:30'))
const pace = paceArg.includes(':')
  ? Number(paceArg.split(':')[0]) * 60 + Number(paceArg.split(':')[1])
  : Number(paceArg)
const targetKm = Number(arg('target', 2.0))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? `  ${detail}` : ''}`)
}

const real = JSON.parse(readFileSync('run-analysis.json', 'utf8'))
  .map((r) => r.analysis)
  .filter((a) => Math.abs((a.distance * 1000) / a.duration - a.speed.avg) < 1.0)

const plan = JSON.parse(readFileSync('route-plan.json', 'utf8'))
const checkpoints = plan.checkpoints.map((c, i) => ({
  id: String(Array.isArray(c.id) ? c.id.join('/') : c.id ?? i + 1),
  lat: +c.lat,
  lng: +c.lng,
}))

console.log('=== 模拟轨迹验收 ===')
console.log(`样本 ${runs} 条 · 配速 ${paceArg} · 目标 ${targetKm} km · 对照真实记录 ${real.length} 条\n`)

const sims = []
for (let k = 0; k < runs; k++) {
  const seed = 5000 + k * 97
  const path = buildPath({ checkpoints, mode: 'free', r: rng(seed) })
  const run = generateRun({
    route: path.points,
    checkpoints,
    targetKm,
    seed,
    paceSecPerKm: pace,
    sensorHz: 5,
  })
  const analysis = analyzeTrack(run.points, { time: run.meta.duration, distance: run.meta.distanceKm })
  const diag = diagnose(analysis, run.sensors.steps.total)
  sims.push({ seed, run, analysis, diag, path })
}

console.log('A. 格式一致性')
const p0 = sims[0].run.points
const keySet = new Set()
for (const p of p0) for (const k of Object.keys(p)) keySet.add(k)
check('字段集合 ⊆ {o,a,s,p,l}', [...keySet].every((k) => 'oaspl'.includes(k)), [...keySet].join(','))
check('必备字段齐全', ['o', 'a', 's', 'l'].every((k) => k in p0[0]))
check('经纬度为 float32', p0.every((p) => Math.fround(p.a) === p.a && Math.fround(p.o) === p.o))
check(
  '速度为 2 位小数（float32 落地，容差 1e-3）',
  p0.every((p) => Math.abs(p.s * 100 - Math.round(p.s * 100)) < 1e-3),
)
check('l 恒为 1', p0.every((p) => p.l === 1))
check('p 标记只出现 0/1', p0.every((p) => p.p == null || p.p === 1))
check('首点坐标为起点附近', haversine(p0[0].a, p0[0].o, sims[0].path.points[0].lat, sims[0].path.points[0].lng) < 60)
console.log()

console.log('B. 加密往返')
{
  const sample = sims[0].run.points
  const packed = await packTrack(sample)
  const back = await unpackTrack(packed.body)
  check('明文为 JSON 数组', packed.plain.startsWith('[{"o":'))
  check('base64 为 76 列换行', packed.body.split('\n').every((l) => l.length <= 76))
  check('点数一致', back.length === sample.length, `${back.length}`)
  const identical = back.every(
    (b, i) => b.o === sample[i].o && b.a === sample[i].a && b.s === sample[i].s && (b.p ?? null) === (sample[i].p ?? null) && b.l === 1,
  )
  check('逐字段还原一致', identical)
  check('无填充残留（可被标准 AES-CBC 解开）', typeof back[0].a === 'number')
}
console.log()

console.log('C. 真实性诊断')
const scores = sims.map((s) => s.diag.score)
check(`${runs} 条全部 100 分`, scores.every((s) => s === 100), `最低 ${Math.min(...scores)}`)
const failing = sims.filter((s) => s.diag.issues.length)
check('无异常项', failing.length === 0, failing.slice(0, 2).map((s) => s.diag.issues.join(';')).join(' | '))
console.log()

console.log('D. 统计分布（模拟均值 vs 真实均值）')
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
const rows = [
  ['轨迹点数', mean(real.map((r) => r.points)), mean(sims.map((s) => s.analysis.points)), 0.55, 1.8],
  [
    '速度标度 s/真速',
    mean(real.map((r) => r.speed.avg / ((r.distance * 1000) / r.duration))),
    mean(sims.map((s) => s.analysis.speed.avg / ((s.run.meta.distanceKm * 1000) / s.run.meta.duration))),
    0.9,
    1.15,
  ],
  ['速度标准差', mean(real.map((r) => r.speed.std)), mean(sims.map((s) => s.analysis.speed.std)), 0.6, 1.8],
  ['最高速度 m/s', mean(real.map((r) => r.speed.max)), mean(sims.map((s) => s.analysis.speed.max)), 0.7, 1.4],
  ['最大加速度', mean(real.map((r) => r.maxAccel)), mean(sims.map((s) => s.analysis.maxAccel)), 0.5, 2.0],
  ['位移自相关', mean(real.map((r) => r.autocorr)), mean(sims.map((s) => s.analysis.autocorr)), 0.75, 1.3],
  ['速度自相关', mean(real.map((r) => r.speedAutocorr)), mean(sims.map((s) => s.analysis.speedAutocorr)), 0.85, 1.15],
  ['停顿占比 %', mean(real.map((r) => r.stoppedRatio)), mean(sims.map((s) => s.analysis.stoppedRatio)), 0.4, 2.2],
  ['GPS 噪声 %', mean(real.map((r) => r.gpsNoisePct)), mean(sims.map((s) => s.analysis.gpsNoisePct)), 0.45, 2.0],
]
for (const [name, r, s, lo, hi] of rows) {
  const ratio = r > 0 ? s / r : 0
  check(
    `${name.padEnd(12)} 真实 ${r.toFixed(2).padStart(7)} → 模拟 ${s.toFixed(2).padStart(7)}（×${ratio.toFixed(2)}）`,
    ratio >= lo && ratio <= hi,
  )
}
console.log()

console.log('E. 打卡点覆盖')
{
  let allHit = true
  let wrongMark = 0
  for (const s of sims) {
    const cps = s.run.meta.checkpoints
    if (cps.some((c) => !c.hit)) allHit = false
    const marked = s.run.points.filter((p) => p.p === 1).length
    if (marked !== cps.filter((c) => c.hit).length) wrongMark++
  }
  check('每条轨迹覆盖全部打卡点', allHit, `${checkpoints.length} 个点`)
  check('p=1 的个数 == 命中数', wrongMark === 0, `异常 ${wrongMark} 条`)
  const dists = sims.flatMap((s) => s.run.meta.checkpoints.map((c) => c.minDistance))
  check(`命中距离全部 ≤ 30 m`, Math.max(...dists) <= 30, `最大 ${Math.max(...dists).toFixed(1)} m`)
}
console.log()

console.log('F. 传感器自洽')
{
  let ok = true
  const detail = []
  for (const s of sims) {
    const st = s.run.sensors.steps
    const km = s.run.meta.distanceKm
    const implied = (st.total * st.avgStride) / 1000
    if (Math.abs(implied - km) / km > 0.05) {
      ok = false
      detail.push(`步数×步幅 ${implied.toFixed(2)} vs ${km}`)
    }
  }
  check('步数 × 平均步幅 ≈ 距离（±5%）', ok, detail[0] ?? '')
  const cad = sims.map((s) => s.run.sensors.steps.avgCadence)
  check('平均步频 140~190 spm', cad.every((c) => c >= 140 && c <= 190), `${Math.min(...cad).toFixed(0)}~${Math.max(...cad).toFixed(0)}`)
  const stride = sims.map((s) => s.run.sensors.steps.avgStride)
  check('平均步幅 0.7~1.4 m', stride.every((c) => c >= 0.7 && c <= 1.4), `${Math.min(...stride).toFixed(2)}~${Math.max(...stride).toFixed(2)}`)
  const perMinuteOk = sims.every((s) => {
    const st = s.run.sensors.steps
    const sum = st.perMinuteDelta.reduce((a, b) => a + b, 0)
    return Math.abs(sum - st.total) / Math.max(1, st.total) < 0.05
  })
  check('每分钟步数求和 == 总步数（±5%）', perMinuteOk)
  const hr = sims.flatMap((s) => s.run.sensors.heartRate.map((h) => h.bpm))
  check('心率 60~200 bpm', hr.every((b) => b >= 60 && b <= 200), `${Math.min(...hr)}~${Math.max(...hr)}`)
  const imuOk = sims.every((s) => {
    const imu = s.run.sensors.imu
    return imu.length > 10 && imu.every((f) => Math.abs(f.az) < 60 && Math.abs(f.gz) < 20)
  })
  check('IMU 数值在物理范围内', imuOk)
}
console.log()

console.log('G. 时间轴统一')
{
  const s = sims[0].run
  check('传感器时间轴终点 == 轨迹时长', Math.abs(s.sensors.timescale.end - s.meta.duration) <= 1.5, `${s.sensors.timescale.end} vs ${s.meta.duration}`)
  check('IMU 帧数 ≈ 时长 × 采样率', Math.abs(s.sensors.imu.length - s.meta.duration * s.sensors.timescale.hz) <= s.sensors.timescale.hz + 1)
  check('心率帧数 ≈ 时长（1 Hz）', Math.abs(s.sensors.heartRate.length - s.meta.duration) <= 2)
  check('IMU 时间单调递增', s.sensors.imu.every((f, i, a) => i === 0 || f.t >= a[i - 1].t))
  check('startTime + duration == endTime', s.meta.startTime + s.meta.duration === s.meta.endTime)
}
console.log()

console.log(`结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
