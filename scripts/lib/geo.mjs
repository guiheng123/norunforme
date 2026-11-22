export const R_EARTH = 6371000
export const rad = (d) => (d * Math.PI) / 180
export const deg = (r) => (r * 180) / Math.PI

export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)))
}
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣

export function bearing(lat1, lng1, lat2, lng2) {
  const φ1 = rad(lat1)
  const φ2 = rad(lat2)
  const Δλ = rad(lng2 - lng1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

export function destination(lat, lng, brg, dist) {
  const δ = dist / R_EARTH
  const θ = rad(brg)
  const φ1 = rad(lat)
  const λ1 = rad(lng)
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  return { lat: deg(φ2), lng: ((deg(λ2) + 540) % 360) - 180 }
}

export const f32 = Math.fround

export function cumulative(points) {
  const out = [0]
  for (let i = 1; i < points.length; i++)
    out.push(out[i - 1] + haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng))
  return out
}

export function pointAt(points, cum, s) {
  if (points.length === 1) return { ...points[0] }
  const total = cum[cum.length - 1]
  let d = Math.max(0, Math.min(total, s))
  let lo = 0
  let hi = cum.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= d) lo = mid
    else hi = mid
  }
  const seg = cum[hi] - cum[lo]
  const t = seg > 1e-9 ? (d - cum[lo]) / seg : 0
  return {
    lat: points[lo].lat + (points[hi].lat - points[lo].lat) * t,
    lng: points[lo].lng + (points[hi].lng - points[lo].lng) * t,
  }
}

export function resample(points, step = 0.5) {
  const cum = cumulative(points)
  const total = cum[cum.length - 1]
  const n = Math.max(2, Math.ceil(total / step) + 1)
  const out = []
  for (let i = 0; i < n; i++) out.push(pointAt(points, cum, (i / (n - 1)) * total))
  return { points: out, total }
}

export function closeLoop(points) {
  if (points.length < 2) return points
  const a = points[0]
  const b = points[points.length - 1]
  if (haversine(a.lat, a.lng, b.lat, b.lng) < 1) return points
  return [...points, { ...a }]
}

export function polylineLength(points) {
  const c = cumulative(points)
  return c[c.length - 1]
}

export function nearestOnPath(points, cum, lat, lng) {
  let best = { dist: Infinity, s: 0, index: 0 }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const kx = Math.cos(rad(a.lat)) * 111320
    const ky = 110540
    const ax = 0
    const ay = 0
    const bx = (b.lng - a.lng) * kx
    const by = (b.lat - a.lat) * ky
    const px = (lng - a.lng) * kx
    const py = (lat - a.lat) * ky
    const vx = bx - ax
    const vy = by - ay
    const len2 = vx * vx + vy * vy
    let t = len2 > 0 ? (px * vx + py * vy) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const dx = px - vx * t
    const dy = py - vy * t
    const dist = Math.hypot(dx, dy)
    if (dist < best.dist)
      best = { dist, s: cum[i - 1] + (cum[i] - cum[i - 1]) * t, index: i }
  }
  return best
}

export function rng(seed = 1) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    gauss() {
      let u = 0
      let v = 0
      while (u === 0) u = next()
      while (v === 0) v = next()
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    },
    range(min, max) {
      return min + (max - min) * next()
    },
    int(min, max) {
      return Math.floor(min + (max - min + 1) * next())
    },
    chance(p) {
      return next() < p
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)]
    },
  }
}
