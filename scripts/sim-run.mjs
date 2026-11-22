import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
import { join } from 'node:path'
import { buildPath, loadRouteFile } from './lib/route.mjs'
import { generateRun } from './lib/gen.mjs'
import { packTrack, unpackTrack } from './lib/trackfile.mjs'
import { analyzeTrack, diagnose } from './lib/track-analysis.mjs'
import { rng } from './lib/geo.mjs'
import { installExitShim } from './lib/exit.mjs'

installExitShim()

const argv = process.argv.slice(2)
const arg = (name, def = null) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def
}
const has = (name) => argv.includes('--' + name)

function parsePace(v) {
  if (v == null || v === true) return null
  const s = String(v).replace(/["'’]/g, ':')
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s))
  const m = s.match(/^(\d+)[:\s](\d{1,2})/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  throw new Error(`配速格式无法识别：${v}`)
}

const routeArg = arg('route', null)
const cpArg = arg('checkpoints', 'auto')
const targetKm = Number(arg('target', 0)) || 0
const paceSecPerKm = parsePace(arg('pace', null)) ?? 330
const seed = Number(arg('seed', Math.floor(Math.random() * 1e6)))
const outDir = String(arg('out', `out/run-${seed}`))
const sensorHz = Number(arg('sensor-hz', 10))
const startTime = arg('start-time', null)
const mode = arg('mode', 'free')
const radius = Number(arg('radius', 30))
const viaArg = arg('via', null)

function loadCheckpoints(spec) {
  if (spec === 'none' || spec === false) return { list: [], src: '已禁用' }
  if (spec && spec !== 'auto' && existsSync(String(spec))) {
    const j = JSON.parse(readFileSync(String(spec), 'utf8'))
    const list = (Array.isArray(j) ? j : j.checkpoints ?? []).map((c, i) => ({
      id: String(c.id ?? c.ids ?? i + 1),
      name: c.name ?? `打卡点${i + 1}`,
      lat: +c.lat,
      lng: +c.lng,
      seen: c.seen ?? 0,
    }))
    return { list, src: spec }
  }
  for (const f of ['checkpoints.json', 'route-plan.json']) {
    if (!existsSync(f)) continue
    const j = JSON.parse(readFileSync(f, 'utf8'))
    const list = (j.checkpoints ?? []).map((c, i) => ({
      id: String(Array.isArray(c.id) ? c.id.join('/') : (c.id ?? i + 1)),
      name: c.name ?? `打卡点${i + 1}`,
      lat: +c.lat,
      lng: +c.lng,
      seen: c.seen ?? 0,
    }))
    if (list.length) return { list, src: f }
  }
  return { list: [], src: '未找到' }
}

const { list: checkpoints, src: cpSrc } = loadCheckpoints(cpArg)

let routePoints = []
let routeSrc = '打卡点自动排序'
if (typeof viaArg === 'string') {
  routePoints = viaArg
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [lat, lng] = pair.split(',').map(Number)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`--via 坐标格式错误：${pair}`)
      return { lat, lng }
    })
  routeSrc = '--via 指定折线'
}
if (routeArg && existsSync(String(routeArg))) {
  const r = loadRouteFile(String(routeArg))
  routePoints = r.points
  routeSrc = String(routeArg)
  if (!checkpoints.length && r.checkpoints?.length) checkpoints.push(...r.checkpoints)
}

if (!routePoints.length && !checkpoints.length && existsSync('route-plan.json')) {
  const r = loadRouteFile('route-plan.json')
  routePoints = r.points
  routeSrc = 'route-plan.json（无打卡点）'
}

const path = buildPath({
  points: mode === 'auto' || !routePoints.length ? [] : routePoints,
  checkpoints,
  targetKm: 0,
  mode,
  r: rng(seed),
})

const run = generateRun({
  route: path.points,
  checkpoints,
  targetKm,
  seed,
  paceSecPerKm,
  sensorHz,
  checkpointRadius: radius,
  startTime: startTime ? Number(startTime) : null,
})

const packed = await packTrack(run.points)
const back = await unpackTrack(packed.body)
const analysis = analyzeTrack(back, { time: run.meta.duration, distance: run.meta.distanceKm })
const diag = diagnose(analysis, run.sensors.steps.total)

mkdirSync(outDir, { recursive: true })

writeFileSync(join(outDir, 'track.json'), JSON.stringify(run.points))
writeFileSync(join(outDir, 'track.b64'), packed.body)
writeFileSync(join(outDir, 'run.json'), JSON.stringify({ meta: run.meta, sensors: run.sensors }, null, 1))
writeFileSync(
  join(outDir, 'route.json'),
  JSON.stringify(
    { source: routeSrc, lengthKm: path.lengthKm, laps: path.laps, points: path.points, checkpoints: run.meta.checkpoints },
    null,
    1,
  ),
)
writeFileSync(join(outDir, 'preview.html'), buildPreview(run, path, analysis))
writeFileSync(
  join(outDir, 'track.gpx'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="lepao-sim">\n <trk><name>sim-${seed}</name><trkseg>\n` +
    run.points.map((p) => `  <trkpt lat="${p.a}" lon="${p.o}"></trkpt>`).join('\n') +
    '\n </trkseg></trk>\n</gpx>\n',
)

const hits = run.meta.checkpoints.filter((c) => c.hit)
const miss = run.meta.checkpoints.filter((c) => !c.hit)

console.log('=== 模拟跑步 ===\n')
console.log(`路线来源   ：${routeSrc}${path.laps > 1 ? `（${path.laps} 圈）` : ''}`)
console.log(`打卡点来源 ：${cpSrc}（${run.meta.checkpoints.length} 个）`)
console.log(`路线长度   ：${path.lengthKm} km`)
console.log(`目标配速   ：${fmtPace(paceSecPerKm)}`)
console.log(`随机种子   ：${seed}\n`)

console.log(`距离       ：${run.meta.distanceKm} km`)
console.log(`用时       ：${Math.floor(run.meta.duration / 60)}分${run.meta.duration % 60}秒`)
console.log(`实际配速   ：${analysis.pace}`)
console.log(`轨迹点     ：${run.points.length} 个（间隔 ≈ ${run.meta.interval}s）`)
console.log(
  `速度       ：平均 ${analysis.speed.avg} / 最大 ${analysis.speed.max} / 标准差 ${analysis.speed.std} m/s`,
)
console.log(`连续性     ：位移自相关 ${analysis.autocorr} / 速度自相关 ${analysis.speedAutocorr}`)
console.log(`停顿占比   ：${analysis.stoppedRatio}%`)
console.log(`GPS 噪声   ：${analysis.gpsNoisePct}%（原始 ${analysis.rawDistance} / 平滑 ${analysis.smoothDistance} km）`)
console.log(`打卡命中   ：${hits.length}/${run.meta.checkpoints.length}`)
for (const c of hits) console.log(`  ✅ ${c.name.padEnd(8)} 最近 ${c.minDistance} m  t=${c.hitTime}s`)
for (const c of miss) console.log(`  ⚠️  ${c.name.padEnd(8)} 最近 ${c.minDistance} m（超出 ${radius} m 判定半径）`)
if (miss.length && targetKm > 0 && targetKm < path.lengthKm)
  console.log(`
提示：目标 ${targetKm} km 小于路线长度 ${path.lengthKm} km，跑不完整个环线，必然漏打卡点。`)
if (miss.length && targetKm >= path.lengthKm)
  console.log(`
提示：打卡点偏离路线较远，可加大 --radius 或调整 --via/--route 让路线经过它。`)

console.log(`\n传感器账本 ：步数 ${run.sensors.steps.total}  平均步频 ${run.sensors.steps.avgCadence} spm  平均步幅 ${run.sensors.steps.avgStride} m`)
console.log(`            IMU ${run.sensors.imu.length} 帧 @${sensorHz}Hz  心率 ${run.sensors.heartRate.length} 帧 @1Hz  统一时间轴 0~${run.sensors.timescale.end}s`)

console.log(`\n真实性诊断 ：${diag.score} 分 — ${diag.verdict}`)
for (const c of diag.checks) console.log(`  ${c.pass ? '✅' : '⚠️ '} ${c.name.padEnd(10)} ${c.detail}`)

console.log(`\n已写入 ${outDir}/`)
console.log(`  track.json  ${run.points.length} 点`)
console.log(`  track.b64   ${(packed.bytes / 1024).toFixed(1)} KB（AES-128-CBC / base64 / 76 列换行）`)
console.log(`  run.json    含 meta + 传感器`)
console.log(`  track.gpx   可导入地图或真机回放`)

if (diag.score < 100) {
  console.log('\n⚠️ 存在异常项，建议调整 --seed 或参数后重跑')
  process.exitCode = 2
}

/** 自包含预览页：轨迹 + 速度着色 + 打卡点 + 统计（不依赖任何外网资源） */
function buildPreview(run, pathObj, analysis) {
  const pts = run.points
  const lats = pts.map((p) => p.a)
  const lngs = pts.map((p) => p.o)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const W = 760
  const H = 560
  const pad = 28
  const sx = (W - pad * 2) / Math.max(1e-9, maxLng - minLng)
  const sy = (H - pad * 2) / Math.max(1e-9, maxLat - minLat)
  const s = Math.min(sx, sy)
  const cx = (lng) => pad + (lng - minLng) * s + (W - pad * 2 - (maxLng - minLng) * s) / 2
  const cy = (lat) => H - pad - (lat - minLat) * s - (H - pad * 2 - (maxLat - minLat) * s) / 2
  const maxS = Math.max(...pts.map((p) => p.s), 1)
  const segs = []
  for (let i = 1; i < pts.length; i++) {
    const v = (pts[i].s + pts[i - 1].s) / 2
    const hue = 210 - 190 * Math.min(1, v / maxS)
    segs.push(
      `<line x1="${cx(pts[i - 1].o).toFixed(1)}" y1="${cy(pts[i - 1].a).toFixed(1)}" x2="${cx(pts[i].o).toFixed(1)}" y2="${cy(pts[i].a).toFixed(1)}" stroke="hsl(${hue.toFixed(0)} 85% 52%)" stroke-width="2.4" stroke-linecap="round"/>`,
    )
  }
  const marks = run.meta.checkpoints
    .filter((c) => c.hit)
    .map(
      (c) =>
        `<circle cx="${cx(c.lng).toFixed(1)}" cy="${cy(c.lat).toFixed(1)}" r="7" fill="#0f0" fill-opacity=".18" stroke="#0c0" stroke-width="1.4"/><text x="${(cx(c.lng) + 10).toFixed(1)}" y="${(cy(c.lat) + 4).toFixed(1)}" font-size="11" fill="#0a0">${c.name}</text>`,
    )
    .join('')
  const start = pts[0]
  return `<!doctype html><meta charset="utf-8"><title>模拟跑步 ${run.meta.seed}</title>
<style>body{margin:0;background:#0b0f14;color:#dbe6f2;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif}
.wrap{display:flex;gap:24px;padding:22px;flex-wrap:wrap}
svg{background:#0e141b;border:1px solid #1d2a36;border-radius:12px}
table{border-collapse:collapse}td{padding:4px 10px;border-bottom:1px solid #16202b}
b{color:#7fd1ff}.k{color:#7c8b9c}</style>
<div class="wrap"><svg width="${W}" height="${H}">${segs.join('')}${marks}
<circle cx="${cx(start.o).toFixed(1)}" cy="${cy(start.a).toFixed(1)}" r="6" fill="#fff"/>
<text x="${(cx(start.o) + 10).toFixed(1)}" y="${(cy(start.a) - 8).toFixed(1)}" font-size="12" fill="#fff">起点</text></svg>
<div><h3 style="margin:0 0 10px">模拟跑步 · seed ${run.meta.seed}</h3><table>
<tr><td class="k">距离</td><td><b>${run.meta.distanceKm} km</b></td></tr>
<tr><td class="k">用时</td><td><b>${Math.floor(run.meta.duration / 60)}分${run.meta.duration % 60}秒</b></td></tr>
<tr><td class="k">配速</td><td><b>${analysis.pace}</b></td></tr>
<tr><td class="k">轨迹点</td><td>${pts.length}</td></tr>
<tr><td class="k">速度</td><td>均 ${analysis.speed.avg} / 峰 ${analysis.speed.max} / σ ${analysis.speed.std} m/s</td></tr>
<tr><td class="k">自相关</td><td>位移 ${analysis.autocorr} / 速度 ${analysis.speedAutocorr}</td></tr>
<tr><td class="k">停顿</td><td>${analysis.stoppedRatio}%</td></tr>
<tr><td class="k">GPS 噪声</td><td>${analysis.gpsNoisePct}%</td></tr>
<tr><td class="k">打卡</td><td>${run.meta.hitCount}/${run.meta.checkpoints.length}</td></tr>
<tr><td class="k">步数</td><td>${run.sensors.steps.total}（${run.sensors.steps.avgCadence} spm）</td></tr>
<tr><td class="k">圈数</td><td>${pathObj.laps}</td></tr>
</table><p class="k" style="max-width:320px">颜色按速度着色：蓝=慢，红=快。绿圈为打卡命中点。</p></div></div>`
}

function fmtPace(sec) {
  return `${Math.floor(sec / 60)}'${String(Math.round(sec % 60)).padStart(2, '0')}"`
}
