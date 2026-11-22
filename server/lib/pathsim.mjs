import { meters } from './sim.mjs'

const R = 6371000
const toRad = (d) => (d * Math.PI) / 180

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

function chaikin (pts, iterations = 2) {
  let cur = pts
  for (let k = 0; k < iterations; k++) {
    if (cur.length < 3) break
    const next = [cur[0]]
    for (let i = 0; i < cur.length - 1; i++) {
      const [a1, o1] = cur[i]
      const [a2, o2] = cur[i + 1]
      next.push([a1 * 0.75 + a2 * 0.25, o1 * 0.75 + o2 * 0.25])
      next.push([a1 * 0.25 + a2 * 0.75, o1 * 0.25 + o2 * 0.75])
    }
    next.push(cur[cur.length - 1])
    cur = next
  }
  return cur
}

function resample (path, stepMeters, maxPoints = 20000) {
  const segs = []
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const d = meters(path[i - 1], path[i])
    segs.push({ a: path[i - 1], b: path[i], d, start: total })
    total += d
  }
  if (!segs.length || total <= 0) return { points: path.slice(), total: 0 }
  const n = Math.min(maxPoints, Math.max(2, Math.round(total / stepMeters)))
  const pts = []
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * total
    let seg = segs[segs.length - 1]
    for (const g of segs) { if (s <= g.start + g.d) { seg = g; break } }
    const t = seg.d === 0 ? 0 : (s - seg.start) / seg.d
    pts.push([seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t])
  }
  return { points: pts, total }
}

function pointAt (pts, dist, total) {
  if (total <= 0) return pts[0]
  const loop = total * 2
  let d = dist % loop
  if (d < 0) d += loop
  const back = d > total
  const s = back ? loop - d : d
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = meters(pts[i - 1], pts[i])
    if (acc + seg >= s) {
      const t = seg === 0 ? 0 : (s - acc) / seg
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]
    }
    acc += seg
  }
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  return pts[pts.length - 1]
}

export function weaveCheckpoints (path, checkpoints = [], snapRadius = 8, stepMeters = 5.4) {
  const clean = (path || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]))
  if (clean.length < 2) throw new Error('至少需要两个端点')

  const dense = []
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i - 1]
    const b = clean[i]
    const seg = meters(a, b)
    const n = Math.max(1, Math.round(seg / stepMeters))
    for (let k = 0; k < n; k++) {
      const t = k / n
      dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  dense.push(clean[clean.length - 1])

  const assigned = checkpoints.map((c) => {
    const cp = [Number(c.lat), Number(c.lng)]
    let best = Infinity
    let idx = 0
    for (let i = 0; i < dense.length; i++) {
      const d = meters(dense[i], cp)
      if (d < best) { best = d; idx = i }
    }
    return { c, cp, idx, dist: best }
  })

  const byIdx = new Map()
  for (const a of assigned) {
    if (!byIdx.has(a.idx)) byIdx.set(a.idx, [])
    byIdx.get(a.idx).push(a)
  }

  const waypoints = []
  const inserted = []
  const snapped = []

  for (let i = 0; i < dense.length; i++) {
    const group = byIdx.get(i)
    if (!group) {
      waypoints.push(dense[i])
      continue
    }
    const list = group.slice().sort((x, y) => x.dist - y.dist)
    for (const g of list) {
      if (g.dist <= snapRadius) {
        waypoints.push([g.cp[0], g.cp[1]])
        snapped.push({ id: String(g.c.id), name: g.c.name || '', distM: +g.dist.toFixed(1), mode: 'snap' })
      } else {
        waypoints.push([g.cp[0], g.cp[1]])
        waypoints.push(dense[i])
        inserted.push({ id: String(g.c.id), name: g.c.name || '', distM: +g.dist.toFixed(1), mode: 'detour' })
      }
    }
  }

  return { waypoints, snapped, inserted }
}

export function simulateAlong (o) {
  const {
    path, targetKm, paceSec, seed = 1, checkpoints = [], radius = 25,
    stepMeters = 5.4, intervalMs = 1800, startTs = Math.floor(Date.now() / 1000),
    noisePct = 8,
  } = o

  const clean = (path || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (clean.length < 2) throw new Error('至少需要两个端点')
  const resampled = resample(clean, stepMeters)
  if (resampled.total < 20) throw new Error('路径过短，请在地图上多画一段（至少 50 米）')
  const dense = chaikin(resampled.points, 2)
  const total = resampled.total

  const needMeters = targetKm * 1000
  const totalPoints = Math.max(30, Math.round(needMeters / stepMeters))
  const dt = intervalMs / 1000
  const speedBase = 1000 / paceSec
  const targetNoise = Math.min(60, Math.max(0, Number(noisePct) || 0))

  function gen (noiseScale, pins = []) {
    const rnd = mulberry32(seed || 1)

    const speeds = new Array(totalPoints)
    let ou = 0
    const tau = 0.985
    for (let i = 0; i < totalPoints; i++) {
      ou = tau * ou + Math.sqrt(1 - tau * tau) * gauss(rnd) * 0.06
      let v = speedBase * (1 + ou)
      const t = i / totalPoints
      speeds[i] = speedBase * (1 + Math.max(-0.03, Math.min(0.03, (speeds[i] ?? v) / speedBase - 1)))
    }

    const driftAmp = 1.6e-6 * noiseScale
    const whiteAmp = 1.2e-6 * noiseScale
    const pts = []
    let s = 0
    let driftLat = 0
    let driftLng = 0
    const pinAt = new Map()
    for (const pin of pins) pinAt.set(pin.idx, pin)
    while (pts.length < totalPoints) {
      const i = pts.length
      const v = speeds[i]
      const [la, lng] = pointAt(dense, s, total)
      driftLat = 0.94 * driftLat + gauss(rnd) * driftAmp
      driftLng = 0.94 * driftLng + gauss(rnd) * driftAmp
      const pin = pinAt.get(i)
      const a = +(la + driftLat + gauss(rnd) * whiteAmp).toFixed(7)
      const o = +(lng + driftLng + gauss(rnd) * whiteAmp).toFixed(7)
      const frame = { a, o, s: +v.toFixed(2), l: 1 }
      if (pin) {
        const dPin = Math.hypot(
          (a - pin.lat) * 111320,
          (o - pin.lng) * 111320 * Math.cos((pin.lat * Math.PI) / 180),
        )
        frame.nearCp = pin.cid
        frame.dCp = +dPin.toFixed(2)
      }
      pts.push(frame)
      s += Math.max(0.4, v * dt)
    }
    return pts
  }

  function measureNoise (pts) {
    const sm = pts.map((_, i) => {
      const win = pts.slice(Math.max(0, i - 2), Math.min(pts.length, i + 3))
      return [
        win.reduce((a, x) => a + x.a, 0) / win.length,
        win.reduce((a, x) => a + x.o, 0) / win.length,
      ]
    })
    let raw = 0
    let smd = 0
    for (let i = 1; i < pts.length; i++) {
      raw += meters([pts[i - 1].a, pts[i - 1].o], [pts[i].a, pts[i].o])
      smd += meters(sm[i - 1], sm[i])
    }
    return smd > 0 ? Math.max(0, ((raw - smd) / smd) * 100) : 0
  }

  const pinIndex = new Map()
  {
    let denseAcc = 0
    const denseDist = [0]
    for (let i = 1; i < dense.length; i++) {
      denseAcc += meters(dense[i - 1], dense[i])
      denseDist.push(denseAcc)
    }
    const totalPath = denseAcc || 1

    const wants = []
    for (const c of checkpoints) {
      let best = Infinity
      let bestS = 0
      for (let i = 0; i < dense.length; i++) {
        const d = meters(dense[i], [c.lat, c.lng])
        if (d < best) { best = d; bestS = denseDist[i] }
      }
      wants.push({
        id: String(c.id), s: bestS, geoDist: +best.toFixed(1), lat: Number(c.lat), lng: Number(c.lng),
      })
    }

    wants.sort((a, b) => a.s - b.s)
    const segLen = totalPoints / Math.max(1, totalPath)
    const n = wants.length
    const minGap = 3
    const span = (n - 1) * minGap
    const scaleDown = Math.min(1, (totalPoints - 6) / Math.max(1, span || 1))
    const slots = wants.map((w, k) => {
      const raw = Math.round(w.s * segLen) + k * minGap * scaleDown
      return Math.min(totalPoints - 3, Math.max(2, raw))
    })
    let last = 0
    for (let k = 0; k < n; k++) {
      let idx = Math.max(slots[k], last + minGap)
      if (idx > totalPoints - 3) idx = totalPoints - 3
      last = idx
      const w = wants[k]
      pinIndex.set(w.id, { idx, lat: w.lat, lng: w.lng, cid: w.id, geoDist: w.geoDist })
    }
  }
  const pins = [...pinIndex.values()]

  let scale = 1
  let out = gen(scale, pins)
  let got = measureNoise(out)
  if (targetNoise <= 0.05) {
    scale = 0
    out = gen(0, pins)
    got = measureNoise(out)
  } else {
    for (let iter = 0; iter < 8; iter++) {
      if (Math.abs(got - targetNoise) <= Math.max(0.6, targetNoise * 0.05)) break
      if (got < 0.05) { scale = scale * 8 + 4 } else { scale = scale * (targetNoise / got) }
      scale = Math.min(400, Math.max(0, scale))
      out = gen(scale, pins)
      got = measureNoise(out)
    }
  }

  const hits = new Map()
  const misses = new Map()
  for (const c of checkpoints) {
    const id = String(c.id)
    let best = Infinity; let bi = -1
    for (let i = 0; i < out.length; i++) {
      const d = meters([out[i].a, out[i].o], [c.lat, c.lng])
      if (d < best) { best = d; bi = i }
    }
    if (bi >= 0 && best <= radius) {
      hits.set(id, { dist: +best.toFixed(2), index: bi, pinned: pinIndex.has(id) })
    } else {
      misses.set(id, +best.toFixed(1))
    }
  }

  const trackCheckpoints = checkpoints.map((c) => ({
    id: String(c.id), lat: c.lat, lng: c.lng, name: c.name || '',
    hit: hits.has(String(c.id)),
    distM: hits.get(String(c.id))?.dist ?? misses.get(String(c.id)) ?? null,
  }))

  return {
    points: out,
    noiseTarget: targetNoise,
    noiseActual: +got.toFixed(1),
    noiseScale: +scale.toFixed(2),
    checkpoints: trackCheckpoints,
    pathLengthM: +total.toFixed(1),
    loops: +(needMeters / total).toFixed(2),
    hits: [...hits.keys()],
    pinned: pins.map((x) => ({ id: x.cid, idx: x.idx, geoDist: x.geoDist })),
    missed: trackCheckpoints.filter((c) => !c.hit).map((c) => ({ id: c.id, name: c.name, distM: c.distM })),
  }
}

export { meters }
export const re_export = { R, toRad }
