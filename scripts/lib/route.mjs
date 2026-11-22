import { readFileSync } from 'node:fs'
import {
  haversine,
  bearing,
  destination,
  cumulative,
  nearestOnPath,
  polylineLength,
  closeLoop,
} from './geo.mjs'

const isLatLng = (o) => o && typeof o.lat === 'number' && typeof o.lng === 'number'

function normalizePoints(raw) {
  const list = Array.isArray(raw) ? raw : raw?.route ?? raw?.points ?? raw?.path ?? []
  const out = []
  for (const p of list) {
    if (Array.isArray(p) && p.length >= 2) out.push({ lat: +p[0], lng: +p[1] })
    else if (isLatLng(p)) out.push({ lat: +p.lat, lng: +p.lng, name: p.name })
    else if (isLatLng({ lat: p.a, lng: p.o })) out.push({ lat: +p.a, lng: +p.o })
  }
  return out.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
}

function parseGpx(text) {
  const out = []
  const re = /<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"/g
  let m
  while ((m = re.exec(text))) out.push({ lat: +m[1], lng: +m[2] })
  return out
}

function parseGeoJson(text) {
  const j = JSON.parse(text)
  const coords =
    j?.geometry?.coordinates ?? j?.features?.[0]?.geometry?.coordinates ?? j?.coordinates ?? []
  return coords.map(([lng, lat]) => ({ lat, lng }))
}

export function loadRouteFile(path) {
  const text = readFileSync(path, 'utf8')
  const head = text.trimStart()
  if (head.startsWith('<')) return { points: parseGpx(text), checkpoints: [] }
  const json = JSON.parse(text)
  if (json?.type === 'LineString' || json?.type === 'Feature' || json?.type === 'FeatureCollection')
    return { points: parseGeoJson(text), checkpoints: normalizePoints(json.checkpoints ?? []) }
  return {
    points: normalizePoints(json),
    checkpoints: (json?.checkpoints ?? []).map((c) => ({
      lat: +c.lat,
      lng: +c.lng,
      id: c.id ?? c.ids ?? null,
      name: c.name ?? null,
      seen: c.seen ?? 0,
    })),
    targetKm: json?.targetKm ?? null,
  }
}

function nnOrder(cps, start) {
  const left = [...cps]
  const route = []
  let cur = start
  while (left.length) {
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    let bi = 0
    let bd = Infinity
    for (let i = 0; i < left.length; i++) {
      const d = haversine(cur.lat, cur.lng, left[i].lat, left[i].lng)
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    cur = left.splice(bi, 1)[0]
    route.push(cur)
  }
  return route
}

function twoOpt(cps) {
  if (cps.length < 4) return cps
  const len = (r) => {
    let d = 0
    for (let i = 1; i < r.length; i++) d += haversine(r[i - 1].lat, r[i - 1].lng, r[i].lat, r[i].lng)
    return d
  }
  let best = [...cps]
  let bestLen = len(best)
  for (let iter = 0; iter < 80; iter++) {
    let improved = false
    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)]
        const l = len(cand)
        if (l < bestLen - 0.5) {
          best = cand
          bestLen = l
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return best
}

export function weaveCheckpoints(points, checkpoints, tolerance = 18) {
  let path = [...points]
  const inserted = []
  for (const cp of checkpoints) {
    const cum = cumulative(path)
    const near = nearestOnPath(path, cum, cp.lat, cp.lng)
    inserted.push({ id: cp.id, inside: near.dist <= tolerance, offset: +near.dist.toFixed(1) })
    if (near.dist <= tolerance) continue
    let idx = near.index
    if (idx < 1) idx = 1
    if (idx > path.length - 1) idx = path.length - 1
    path = [...path.slice(0, idx), { lat: cp.lat, lng: cp.lng }, ...path.slice(idx)]
  }
  return { points: path, report: inserted }
}

export function extendToTargetLoop(points, targetKm, r, laneJitter = 1.2) {
  const loop = closeLoop(points)
  const loopLen = polylineLength(loop)
  if (!targetKm || targetKm <= 0 || loopLen <= 0) return { points: loop, laps: 1, loopLen }
  const laps = Math.max(1, Math.round((targetKm * 1000) / loopLen))
  if (laps === 1) return { points: loop, laps: 1, loopLen }
  const body = loop.slice(0, -1)
  const out = []
  for (let lap = 0; lap < laps; lap++) {
    for (let i = 0; i < body.length; i++) {
      let p = body[i]
      if (r) {
        const nxt = body[(i + 1) % body.length]
        const prev = body[(i - 1 + body.length) % body.length]
        const brg = bearing(prev.lat, prev.lng, nxt.lat, nxt.lng)
        const off = r.gauss() * laneJitter * 0.35
        if (Math.abs(off) > 0.15) p = destination(p.lat, p.lng, brg + 90, off)
      }
      out.push(p)
    }
  }
  out.push(out[0])
  return { points: out, laps, loopLen }
}

export function buildPath(opts) {
  const { points = [], checkpoints = [], targetKm = 0, start = null, mode = 'free', r = null } = opts
  let path = [...points]

  if (path.length < 2) {
    if (checkpoints.length < 2) throw new Error('既没有路线也没有足够的打卡点，无法构建路径')
    const s = start ?? checkpoints[0]
    const ordered = twoOpt(nnOrder(checkpoints, s))
    path = closeLoop([s, ...ordered])
  }

  let weave = { points: path, report: [] }
  if (checkpoints.length) weave = weaveCheckpoints(path, checkpoints)
  path = weave.points

  let extended = { points: closeLoop(path), laps: 1, loopLen: polylineLength(closeLoop(path)) }
  if (targetKm > 0) extended = extendToTargetLoop(path, targetKm, r)

  return {
    points: extended.points,
    laps: extended.laps,
    loopLengthKm: +(extended.loopLen / 1000).toFixed(3),
    lengthKm: +(polylineLength(extended.points) / 1000).toFixed(3),
    checkpointReport: weave.report,
    mode,
  }
}
