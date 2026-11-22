const R = 6371000
const toRad = (d) => (d * Math.PI) / 180
const toDeg = (r) => (r * 180) / Math.PI

export const meters = (p, q) => {
  const dLat = toRad(q[0] - p[0])
  const dLng = toRad(q[1] - p[1])
  const la = toRad((p[0] + q[0]) / 2)
  return Math.hypot(dLat * R, dLng * R * Math.cos(la))
}

function dest (p, bearingRad, dist) {
  const dLat = (dist * Math.cos(bearingRad)) / R
  const dLng = (dist * Math.sin(bearingRad)) / (R * Math.cos(toRad(p[0])))
  return [p[0] + toDeg(dLat), p[1] + toDeg(dLng)]
}

function bearing (p, q) {
  const dLng = toRad(q[1] - p[1])
  const y = Math.sin(dLng) * Math.cos(toRad(q[0]))
  const x = Math.cos(toRad(p[0])) * Math.sin(toRad(q[0])) - Math.sin(toRad(p[0])) * Math.cos(toRad(q[0])) * Math.cos(dLng)
  return Math.atan2(y, x)
}

export function planRoute (checkpoints) {
  const pts = checkpoints.map((c) => [c.lat, c.lng])
  const n = pts.length
  const left = [...Array(n).keys()]
  const order = [left.shift()]
  while (left.length) {
    const cur = pts[order[order.length - 1]]
    let best = 0
    let bestD = Infinity
    left.forEach((k, i) => {
      const d = meters(cur, pts[k])
      if (d < bestD) { bestD = d; best = i }
    })
    order.push(left.splice(best, 1)[0])
  }
  const d = (i, j) => meters(pts[order[i]], pts[order[j]])
  let improved = true
  while (improved) {
    improved = false
    for (let i = 1; i < order.length - 1; i++) {
      for (let j = i + 2; j < order.length; j++) {
        const a = d(i - 1, i) + d(j, j + 1 === order.length ? 0 : j + 1)
        const b = d(i - 1, j) + d(i, j + 1 === order.length ? 0 : j + 1)
        if (b + 1e-9 < a) {
          const seg = order.slice(i, j + 1).reverse()
          order.splice(i, seg.length, ...seg)
          improved = true
        }
      }
    }
  }
  return order.map((k) => pts[k])
}

function mulberry32 (seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (rnd) => {
  let u = 0; let v = 0
  while (!u) u = rnd()
  while (!v) v = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function simulate (o) {
  const {
    route, targetKm, paceSec, seed = 1,
    checkpoints = [], stepMeters = 5.4, intervalMs = 1800,
    startTs = Math.floor(Date.now() / 1000),
  } = o
  const rnd = mulberry32(seed || 1)
  const speedBase = 1000 / paceSec // m/s

  const total = Math.max(30, Math.round((targetKm * 1000) / stepMeters))
  const duration = total * (intervalMs / 1000)

  const speeds = new Array(total)
  let ou = 0
  const tau = 0.985
  for (let i = 0; i < total; i++) {
    ou = tau * ou + Math.sqrt(1 - tau * tau) * gauss(rnd) * 0.06
    let v = speedBase * (1 + ou)
    const t = i / total
    if (t < 0.04) v *= 0.72 + 0.28 * (t / 0.04)
    if (t > 0.96) v *= 0.72 + 0.28 * ((1 - t) / 0.04)
    if (i > 12 && i < total - 12 && i % 90 === 0 && rnd() < 0.55) {
      const hold = 3 + Math.floor(rnd() * 4)
      for (let k = 0; k < hold && i + k < total; k++) speeds[i + k] = speedBase * 0.18
    }
    speeds[i] = Math.max(0.6, Math.min(speedBase * 1.6, speeds[i] ?? v))
  }

  const routePts = route.length >= 2 ? route : [[31.045172, 112.196127], [31.043884, 112.19774]]
  const segs = []
  let routeLen = 0
  for (let i = 0; i < routePts.length; i++) {
    const a = routePts[i]
    const b = routePts[(i + 1) % routePts.length]
    const d = meters(a, b)
    segs.push({ a, b, d, start: routeLen })
    routeLen += d
  }
  if (routeLen < 50) {
    const c = routePts[0]
    routePts.length = 0
    for (let i = 0; i < 40; i++) routePts.push(dest(c, (i / 40) * Math.PI * 2, 160))
    segs.length = 0
    routeLen = 0
    for (let i = 0; i < routePts.length; i++) {
      const a = routePts[i]; const b = routePts[(i + 1) % routePts.length]
      const d = meters(a, b)
      segs.push({ a, b, d, start: routeLen })
      routeLen += d
    }
  }
  const at = (s) => {
    const x = ((s % routeLen) + routeLen) % routeLen
    for (const g of segs) {
      if (x <= g.start + g.d) {
        const t = g.d === 0 ? 0 : (x - g.start) / g.d
        return [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t]
      }
    }
    return routePts[0]
  }

  const points = []
  let s = 0
  let driftLat = 0
  let driftLng = 0
  let t = startTs
  let lastHit = {}
  const hits = new Set()
  for (let i = 0; i < total; i++) {
    const v = speeds[i]
    s += Math.max(0.4, v * (intervalMs / 1000))
    const [la, lng] = at(s)
    driftLat = 0.94 * driftLat + gauss(rnd) * 1.6e-6
    driftLng = 0.94 * driftLng + gauss(rnd) * 1.6e-6
    const pLat = la + driftLat + gauss(rnd) * 1.2e-6
    const pLng = lng + driftLng + gauss(rnd) * 1.2e-6
    const pt = { a: +pLat.toFixed(7), o: +pLng.toFixed(7), s: +v.toFixed(2), l: 1 }
    for (const c of checkpoints) {
      if (lastHit[c.id]) continue
      if (meters([pLat, pLng], [c.lat, c.lng]) <= 12) {
        pt.p = 1
        lastHit[c.id] = true
        hits.add(c.id)
      }
    }
    points.push(pt)
    t += Math.round(intervalMs / 1000)
  }

  const trackCheckpoints = checkpoints.map((c) => ({
    id: String(c.id), lat: c.lat, lng: c.lng, name: c.name || '', hit: hits.has(String(c.id)),
  }))

  const stats = analyzeStats(points, intervalMs)
  return { points, checkpoints: trackCheckpoints, stats, hits: [...hits], duration, routeLen }
}

export function analyzeStats (points, intervalMs = 1800) {
  const dt = intervalMs / 1000
  const sm = points.map((p, i) => {
    const win = points.slice(Math.max(0, i - 2), Math.min(points.length, i + 3))
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    const a = win.reduce((s, x) => s + x.a, 0) / win.length
    const o = win.reduce((s, x) => s + x.o, 0) / win.length
    return [a, o]
  })
  let dist = 0
  let rawDist = 0
  let maxSpeed = 0
  let speedSum = 0
  const vels = []
  for (let i = 1; i < points.length; i++) {
    const d = meters(sm[i - 1], sm[i])
    dist += d
    rawDist += meters([points[i - 1].a, points[i - 1].o], [points[i].a, points[i].o])
    const v = d / dt
    vels.push(v)
    if (v > maxSpeed) maxSpeed = v
    speedSum += v
  }
  const avg = vels.length ? speedSum / vels.length : 0
  const sorted = [...vels].sort((a, b) => a - b)
  const p98 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] : 0
  const noisePct = dist > 0 ? Math.min(100, ((rawDist - dist) / dist) * 100) : 0
  const durationSec = points.length * dt
  const distanceKm = dist / 1000
  return {
    distanceKm: +distanceKm.toFixed(3),
    durationSec: Math.round(durationSec),
    paceSecPerKm: distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0,
    maxSpeed: +p98.toFixed(2),
    avgSpeed: +avg.toFixed(2),
    pointCount: points.length,
    noisePct: +Math.max(0, noisePct).toFixed(1),
  }
}

export function diagnose (stats, rules) {
  const out = []
  const push = (key, label, ok, value, detail, warn = false) =>
    out.push({ key, label, level: ok ? (warn ? 'warn' : 'pass') : 'fail', value, detail })

  push('maxSpeed', '最高速度', stats.maxSpeed <= 6.5, `${stats.maxSpeed} m/s`, '真人跑步峰值一般 ≤ 6.5 m/s（3′00″/km）')
  push('avgSpeed', '平均速度', stats.avgSpeed >= 1.0 && stats.avgSpeed <= 5.6, `${stats.avgSpeed} m/s`, '低于 1.0 或高于 5.6 都不像跑步')
  push('pace', '配速', stats.paceSecPerKm >= (rules?.maxPaceSec ?? 180) && stats.paceSecPerKm <= (rules?.minPaceSec ?? 540),
    `${Math.floor(stats.paceSecPerKm / 60)}'${String(stats.paceSecPerKm % 60).padStart(2, '0')}"`,
    `合格区间 ${Math.floor((rules?.maxPaceSec ?? 180) / 60)}'00" ~ ${Math.floor((rules?.minPaceSec ?? 540) / 60)}'00"`)
  push('noise', 'GPS 噪声', stats.noisePct >= 4 && stats.noisePct <= 45, `${stats.noisePct}%`, '真实轨迹高频抖动一般 5%~40%')
  push('points', '采样点数', stats.pointCount >= 60, `${stats.pointCount} 点`, '过少会被判为轨迹异常')
  push('distance', '里程', stats.distanceKm >= (rules?.minDistanceKm ?? 1.5), `${stats.distanceKm} km`, `合格线 ${rules?.minDistanceKm ?? 1.5} km`)
  push('duration', '时长', stats.durationSec >= 240, `${Math.round(stats.durationSec / 60)} 分钟`, '少于 4 分钟的跑步记录不可信', stats.durationSec < 480)
  return out
}

export function verdictOf (stats, checkpoints, rules) {
  const reasons = []
  const minKm = rules?.minDistanceKm ?? 1.5
  const minPts = rules?.pointNumOnline ?? rules?.minLogNum ?? 2
  if (stats.distanceKm < minKm) reasons.push(`里程 ${stats.distanceKm} km 未达 ${minKm} km`)
  const hit = checkpoints.filter((c) => c.hit).length
  if (hit < minPts) reasons.push(`打卡点 ${hit}/${minPts} 不足`)
  const p = stats.paceSecPerKm
  if (p > (rules?.minPaceSec ?? 540)) reasons.push('配速慢于合格下限')
  if (p < (rules?.maxPaceSec ?? 180)) reasons.push('配速快于合格上限')
  return { pass: reasons.length === 0, reasons }
}
