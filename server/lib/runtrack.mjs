import { meters } from './sim.mjs'

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

function offset (lat, lng, de, dn) {
  return [
    lat + dn / 111320,
    lng + de / (111320 * Math.cos((lat * Math.PI) / 180)),
  ]
}

function densify (path, step = 1) {
  const out = []
  let total = 0
  const cum = [0]
  for (let i = 1; i < path.length; i++) {
    const seg = meters(path[i - 1], path[i])
    const n = Math.max(1, Math.round(seg / step))
    for (let k = 0; k < n; k++) {
      const t = k / n
      out.push([
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ])
      total += seg / n
      cum.push(total)
    }
  }
  out.push(path[path.length - 1])
  return { pts: out, cum, total }
}

function at (dense, s) {
  const { pts, cum, total } = dense
  if (total <= 0) return pts[0]
  const loop = total * 2
  let d = ((s % loop) + loop) % loop
  if (d > total) d = loop - d
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] < d) lo = mid + 1
    else hi = mid
  }
  const i = Math.max(1, lo)
  const segLen = cum[i] - cum[i - 1] || 1
  const t = (d - cum[i - 1]) / segLen
  return [
    pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
    pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
  ]
}

export function buildRunTrack (o = {}) {
  const {
    path = [], checkpoints = [], mustHit = null, targetKm = 1.5,
    speed = 3.1, intervalMs = 1800, noisePct = 8, dwellFrames = 6,
    dwellRadius = 0.5, seed = 1, closedLoopSnap = 30,
  } = o

  const clean = (path || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]))
  if (clean.length < 2) throw new Error('至少需要两个端点')

  const dense = densify(clean, 1)
  if (dense.total < 20) throw new Error('路径过短，请在地图上多画一段（至少 50 米）')

  const step = Math.max(4, Math.min(12, (speed * intervalMs) / 1000))
  const targetMeters = Math.max(200, Number(targetKm) * 1000)

  const wanted = (() => {
    const list = (checkpoints || []).filter((c) => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)))
    if (mustHit && mustHit.length) {
      const ids = mustHit.map(String)
      return list.filter((c) => ids.includes(String(c.id)))
    }
    return list
      .map((c) => {
        let best = Infinity
        for (const p of dense.pts) {
          const d = meters(p, [Number(c.lat), Number(c.lng)])
          if (d < best) best = d
        }
        return { c, d: best }
      })
      .sort((x, y) => x.d - y.d)
      .slice(0, 2)
      .map((x) => x.c)
  })()

  const anchors = wanted.map((c) => {
    const cp = [Number(c.lat), Number(c.lng)]
    let best = Infinity
    let bestS = 0
    for (let i = 0; i < dense.pts.length; i++) {
      const d = meters(dense.pts[i], cp)
      if (d < best) { best = d; bestS = dense.cum[i] }
    }
    return { id: String(c.id), name: c.name || '', cp, s: bestS, offsetM: +best.toFixed(1) }
  }).sort((a, b) => a.s - b.s)

  const spread = []
  for (const a of anchors) {
    if (spread.length && Math.abs(a.s - spread[spread.length - 1].s) < 40) continue
    spread.push(a)
  }
  const useAnchors = spread.length ? spread : anchors

  const lastAnchorS = useAnchors.length ? useAnchors[useAnchors.length - 1].s : 0
  const needMeters = Math.max(targetMeters, lastAnchorS + 200)

  const rnd = mulberry32(seed || 1)
  const amp = Math.max(0, Math.min(45, Number(noisePct) || 0)) / 100
  const frames = []
  const hits = []
  let travelled = 0

  const push = (lat, lng, jitter) => {
    let a = lat
    let o2 = lng
    if (jitter) {
      const [ja, jo] = offset(lat, lng, gauss(rnd) * jitter, gauss(rnd) * jitter)
      a = ja
      o2 = jo
    }
    const prev = frames[frames.length - 1]
    if (prev) travelled += meters([prev.a, prev.o], [a, o2])
    frames.push({ a: +a.toFixed(7), o: +o2.toFixed(7), s: +speed.toFixed(2), l: 1 })
  }

  const lateral = step * amp * 3.5

  let pos = 0
  let ai = 0
  const guard = 200000
  while (travelled < needMeters && frames.length < guard) {
    const anchor = useAnchors[ai]
    if (anchor && pos >= anchor.s - step * 0.5) {
      const [lat, lng] = anchor.cp
      push(lat, lng, 0)
      let stayed = 0
      let lastLat = lat
      let lastLng = lng
      let tries = 0
      while (stayed < dwellFrames - 1 && tries < 500) {
        tries++
        const [ja, jo] = offset(lat, lng, (rnd() * 2 - 1) * dwellRadius, (rnd() * 2 - 1) * dwellRadius)
        if (meters([lastLat, lastLng], [ja, jo]) > dwellRadius) continue
        push(ja, jo, 0)
        lastLat = ja; lastLng = jo
        stayed++
      }
      hits.push({ id: anchor.id, name: anchor.name, index: frames.length - 1, offsetM: anchor.offsetM })
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
      pos = anchor.s + step * 0.5
      ai++
      continue
    }
    const [lat, lng] = at(dense, pos)
    push(lat, lng, lateral)
    pos += step
  }

  let dist = 0
  let maxSpeedGap = 0
  for (let i = 1; i < frames.length; i++) {
    const d = meters([frames[i - 1].a, frames[i - 1].o], [frames[i].a, frames[i].o])
    dist += d
    maxSpeedGap = Math.max(maxSpeedGap, d)
  }
  const durationSec = Math.round((frames.length - 1) * (intervalMs / 1000))

  const sm = frames.map((_, i) => {
    const win = frames.slice(Math.max(0, i - 2), Math.min(frames.length, i + 3))
    return [
      win.reduce((a, x) => a + x.a, 0) / win.length,
      win.reduce((a, x) => a + x.o, 0) / win.length,
    ]
  })
  let raw = 0
  let smd = 0
  for (let i = 1; i < frames.length; i++) {
    raw += meters([frames[i - 1].a, frames[i - 1].o], [frames[i].a, frames[i].o])
    smd += meters(sm[i - 1], sm[i])
  }

  return {
    frames,
    hits,
    anchors: useAnchors.map((a) => ({ id: a.id, name: a.name, s: +a.s.toFixed(1), offsetM: a.offsetM })),
    stats: {
      distanceKm: +(dist / 1000).toFixed(2),
      durationSec,
      pointCount: frames.length,
      speed,
      avgSpeed: +(dist / Math.max(1, durationSec)).toFixed(2),
      maxSpeed: +Math.max(...frames.map((f) => f.s), maxSpeedGap / (intervalMs / 1000)).toFixed(2),
      paceSecPerKm: Math.round(1000 / speed),
      noisePct: smd > 0 ? +(((raw - smd) / smd) * 100).toFixed(1) : 0,
      maxGapM: +maxSpeedGap.toFixed(1),
      stepMeters: +step.toFixed(2),
    },
  }
}
