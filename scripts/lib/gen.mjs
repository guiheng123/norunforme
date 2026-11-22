import { haversine, bearing, resample, cumulative, pointAt, f32, rng } from './geo.mjs'

export const DEFAULTS = {
  interval: 1.8,
  intervalJitter: 0.06,
  paceSecPerKm: 330,
  speedRho: 0.95,
  speedSigma: 0.13,
  slowAmp: 0.14,
  slowPeriod: [55, 130],
  warmup: 40,
  finishKick: 25,
  pausePerSec: 70,
  startHold: 4,
  endHold: 2,
  pauseHold: [2, 7],
  gpsSigma: 0.5,
  gpsRho: 0.9,
  gpsWhite: 2.4,
  spikeChance: 0.0008,
  spikeMag: [60, 160],
  spikeDecay: 0,
  spikeTargetNoise: 0.18,
  driftHold: [4, 12],
  checkpointRadius: 30,
  sensorHz: 10,
  startTime: null,
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function generateRun(opts) {
  const P = { ...DEFAULTS, ...opts }
  const r = rng(opts.seed ?? Math.floor(Math.random() * 1e9))
  const route = opts.route
  if (!route || route.length < 2) throw new Error('route 至少需要 2 个点')

  const { points: dense, total } = resample(route, 0.5)
  const cumDense = cumulative(dense)

  const targetDist = (opts.targetKm && opts.targetKm > 0 ? opts.targetKm * 1000 : total) | 0

  const rs = rng((opts.seed ?? 1) * 31 + 7)
  const estDuration = (targetDist / (1000 / P.paceSecPerKm)) * 1.08
  const pauseCount = Math.max(0, Math.round(estDuration / P.pausePerSec) - 1 + rs.int(0, 1))
  const pauses = []
  for (let i = 0; i < pauseCount; i++) {
    const at = rs.range(45, Math.max(60, estDuration - 45))
    pauses.push({ at, hold: rs.range(P.pauseHold[0], P.pauseHold[1]) })
  }
  pauses.sort((a, b) => a.at - b.at)
  const slowPeriod = rs.range(P.slowPeriod[0], P.slowPeriod[1])
  const slowPhase = rs.range(0, Math.PI * 2)
  const noiseStream = Array.from({ length: 20000 }, () => rs.gauss())
  const dtStream = Array.from({ length: 20000 }, () => rs.range(-P.intervalJitter, P.intervalJitter))

  const timeline = (v0) => {
    const raw = []
    let t = 0
    let dist = 0
    let logV = 0
    let pauseIdx = 0
    let pauseElapsed = -1
    let k = 0
    while (dist < targetDist && k < 19990) {
      const dt = Math.max(0.5, P.interval + dtStream[k])
      logV = P.speedRho * logV + Math.sqrt(1 - P.speedRho ** 2) * P.speedSigma * noiseStream[k]
      k++
      let v = v0 * Math.exp(logV)

      if (t < P.startHold) v *= 0.05
      else if (t < P.warmup) v *= clamp(0.55 + (0.45 * t) / P.warmup, 0.5, 1)
      const remain = Math.max(0, estDuration - t)
      if (remain < P.finishKick) v *= 1 + 0.09 * (1 - remain / P.finishKick)
      v *= 1 + P.slowAmp * Math.sin((2 * Math.PI * t) / slowPeriod + slowPhase)
      v *= 1 + 0.02 * Math.sin((2 * Math.PI * t) / 23 + slowPhase * 2)

      while (pauseIdx < pauses.length && t >= pauses[pauseIdx].at) {
        pauseElapsed = 0
        pauseIdx++
      }
      if (pauseElapsed >= 0) {
        const hold = pauses[pauseIdx - 1]?.hold ?? 4
        const ramp = 3.2
        if (pauseElapsed < ramp) v *= Math.max(0.02, 1 - pauseElapsed / ramp)
        else if (pauseElapsed < ramp + hold) v *= 0.02
        else if (pauseElapsed < ramp * 2 + hold)
          v *= Math.min(1, (pauseElapsed - ramp - hold) / ramp)
        else pauseElapsed = -1
        if (pauseElapsed >= 0) pauseElapsed += dt
      }

      v = clamp(v, 0.05, v0 * 1.18)
      if (targetDist - dist <= v * dt * 2.2) v *= 0.15
      dist += v * dt
      raw.push({ t, dt, v, dist })
      t += dt
    }
    return { raw, duration: Math.round(t), travelled: dist }
  }

  const targetSpeed = 1000 / P.paceSecPerKm
  let v0 = targetSpeed
  let phase = timeline(v0)
  for (let it = 0; it < 3; it++) {
    const actual = phase.travelled / Math.max(1, phase.duration)
    if (Math.abs(actual - targetSpeed) / targetSpeed < 0.008) break
    v0 *= targetSpeed / actual
    phase = timeline(v0)
  }

  const raw = phase.raw
  const duration = phase.duration
  const travelled = phase.travelled

  let nx = 0
  let ny = 0
  let spikeX = 0
  let spikeY = 0
  const base = []

  for (let i = 0; i < raw.length; i++) {
    const { t, v, dist } = raw[i]
    const s = ((dist % total) + total) % total
    const truth = pointAt(dense, cumDense, s)

    nx =
      P.gpsRho * nx +
      Math.sqrt(1 - P.gpsRho ** 2) * P.gpsSigma * r.gauss() +
      P.gpsWhite * r.gauss()
    ny =
      P.gpsRho * ny +
      Math.sqrt(1 - P.gpsRho ** 2) * P.gpsSigma * r.gauss() +
      P.gpsWhite * r.gauss()

    if (r.chance(P.spikeChance)) {
      const mag = r.range(P.spikeMag[0], P.spikeMag[1])
      const brg = r.range(0, 360)
      spikeX = mag * Math.sin((brg * Math.PI) / 180)
      spikeY = mag * Math.cos((brg * Math.PI) / 180)
    }
    base.push({
      t,
      v,
      truth,
      lat: truth.lat + (ny + spikeY) / 110540,
      lng: truth.lng + (nx + spikeX) / (111320 * Math.cos((truth.lat * Math.PI) / 180)),
    })
    spikeX *= P.spikeDecay
    spikeY *= P.spikeDecay
  }

  const samples = base.map((b) => ({ ...b }))
  if (P.spikeTargetNoise > 0) {
    const n = samples.length
    const episodes = []
    const count = r.chance(0.45) ? 2 : 1
    for (let e = 0; e < count; e++) {
      const nearStart = e === 0 && r.chance(0.5)
      const start = nearStart
        ? r.int(2, 6)
        : r.int(Math.min(10, Math.max(10, n - 40)), Math.max(11, n - 12))
      const hold = r.int(P.driftHold[0], P.driftHold[1])
      episodes.push({ start, len: Math.max(2, Math.min(hold, n - start - 1)), mag: 0, brg: r.range(0, 360) })
    }
    const apply = (mags) => {
      for (let i = 0; i < samples.length; i++) {
        let ox = 0
        let oy = 0
        for (let k = 0; k < episodes.length; k++) {
          const ep = episodes[k]
          if (i >= ep.start && i < ep.start + ep.len) {
            ox += mags[k] * Math.sin((ep.brg * Math.PI) / 180)
            oy += mags[k] * Math.cos((ep.brg * Math.PI) / 180)
          }
        }
        samples[i].lat = base[i].lat + oy / 110540
        samples[i].lng =
          base[i].lng + ox / (111320 * Math.cos((base[i].truth.lat * Math.PI) / 180))
      }
    }
    const mags = episodes.map(() => 160)
    for (let iter = 0; iter < 6; iter++) {
      apply(mags)
      const noise = noiseRatio(samples)
      if (Math.abs(noise - P.spikeTargetNoise) < 0.02) break
      const scale = clamp((P.spikeTargetNoise + 1) / (noise + 1), 0.35, 3.5)
      for (let i = 0; i < mags.length; i++) mags[i] = clamp(mags[i] * scale, 12, 2500)
    }
  }

  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]
    if (i < 2) {
      p.lat = base[i].truth.lat
      p.lng = base[i].truth.lng
      if (i === 1) {
        p.lat = samples[0].lat
        p.lng = samples[0].lng
      }
    }
    p.lat = f32(p.lat)
    p.lng = f32(p.lng)
    let sRep = p.v * (1 + 0.035 * r.gauss())
    if (p.v < 0.35) sRep = Math.max(0, sRep * 0.15)
    p.s = f32(Math.round(clamp(sRep, 0, Math.max(v0 * 1.34, 0.5)) * 100) / 100)
    p.t = +p.t.toFixed(2)
    p._v = p.v
    p._truth = p.truth
  }

  const hits = new Map()

  const cpList = (opts.checkpoints ?? []).map((c, i) => ({
    id: c.id ?? String(i + 1),
    name: c.name ?? `打卡点${i + 1}`,
    lat: +c.lat,
    lng: +c.lng,
  }))

  for (const cp of cpList) {
    let best = Infinity
    let bestI = -1
    for (let i = 0; i < samples.length; i++) {
      const d = haversine(samples[i].lat, samples[i].lng, cp.lat, cp.lng)
      if (d < best) {
        best = d
        bestI = i
      }
    }
    cp.minDistance = +best.toFixed(1)
    if (best <= P.checkpointRadius && bestI >= 0) {
      samples[bestI].p = 1
      hits.set(cp.id, { index: bestI, distance: +best.toFixed(1) })
      cp.hit = true
      cp.hitTime = samples[bestI].t
    } else cp.hit = false
  }

  const points = samples.map((p) => {
    const o = { o: p.lng, a: p.lat, s: p.s, l: 1 }
    if (p.p) o.p = 1
    return o
  })

  const sensors = buildSensors(samples, { hz: P.sensorHz, r, paceSecPerKm: P.paceSecPerKm, duration })

  const startTime =
    P.startTime ?? Math.floor(Date.now() / 1000) - duration

  return {
    points,
    sensors,
    meta: {
      seed: opts.seed ?? null,
      startTime,
      endTime: startTime + duration,
      duration,
      distanceKm: +(travelled / 1000).toFixed(2),
      routeLengthKm: +(total / 1000).toFixed(2),
      paceSecPerKm: P.paceSecPerKm,
      interval: P.interval,
      checkpoints: cpList,
      hitCount: cpList.filter((c) => c.hit).length,
    },
    truth: samples.map((p) => ({ lat: p._truth.lat, lng: p._truth.lng, t: p.t, v: +p._v.toFixed(3) })),
  }
}

function rawLen(pts) {
  let d = 0
  for (let i = 1; i < pts.length; i++)
    d += haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng)
  return d
}

function smoothPts(pts, w = 5) {
  const half = Math.floor(w / 2)
  return pts.map((p, i) => {
    let la = 0
    let lo = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(pts.length - 1, i + half); j++) {
      la += pts[j].lat
      lo += pts[j].lng
      n++
    }
    return { lat: la / n, lng: lo / n }
  })
}

function noiseRatio(pts) {
  const raw = rawLen(pts)
  const sm = rawLen(smoothPts(pts))
  return sm > 0 ? raw / sm - 1 : 0
}

export function buildSensors(samples, opts = {}) {
  const hz = opts.hz ?? 10
  const r = opts.r ?? rng(1)
  const paceSecPerKm = opts.paceSecPerKm ?? 330
  const duration = opts.duration ?? (samples.length ? samples[samples.length - 1].t : 0)
  const strideOf = (v) => clamp(0.62 + 0.115 * v, 0.42, 1.5)
  const cadenceOf = (v) => clamp(118 + 19 * v, 0, 190)

  let steps = 0
  const stepSeries = samples.map((p, i) => {
    const dt = i === 0 ? 0 : p.t - samples[i - 1].t
    const v = p._v
    const add = v > 0.35 ? ((cadenceOf(v) / 60) * dt) : 0
    steps += add
    return +steps.toFixed(2)
  })

  const perMinute = []
  let bucket = 0
  let bucketStart = 0
  let last = 0
  for (let i = 0; i < samples.length; i++) {
    const m = Math.floor(samples[i].t / 60)
    while (m > bucket) {
      perMinute.push(Math.round(stepSeries[last]))
      last = i
      bucket++
    }
  }
  perMinute.push(Math.round(stepSeries[samples.length - 1]))

  const perMinuteDelta = perMinute.map((v, i) => v - (i === 0 ? 0 : perMinute[i - 1]))

//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  const hzDt = 1 / hz
  const imu = []
  let phase = 0
  for (let i = 0; i * hzDt <= duration; i++) {
    const t = i * hzDt
    const sp = sampleAt(samples, t)
    const v = sp ? sp._v : 0
    const cad = cadenceOf(v)
    phase += (2 * Math.PI * cad) / 60 * hzDt
    const airborne = v > 0.35 ? 1 : 0.15
    const amp = airborne * (7.5 + 3.4 * v)
    const az = 9.81 + amp * Math.sin(phase) + 0.6 * r.gauss()
    const ax = 0.9 * airborne * Math.sin(phase / 2 + 0.7) + 0.45 * r.gauss()
    const ay = 0.7 * airborne * Math.cos(phase / 2) + 0.45 * r.gauss()
    const heading = sp ? headingAt(samples, t) : 0
    const prevHeading = i > 0 ? imu[i - 1]._h : heading
    let dh = heading - prevHeading
    if (dh > 180) dh -= 360
    if (dh < -180) dh += 360
    const gz = (dh / hzDt) * (Math.PI / 180) + 0.05 * r.gauss()
    imu.push({
      t: +t.toFixed(2),
      ax: round2(ax),
      ay: round2(ay),
      az: round2(az),
      gx: round2(2.2 * Math.sin(phase / 2) * (airborne ? 1 : 0.2) + 0.05 * r.gauss()),
      gy: round2(0.9 * Math.cos(phase / 2) * (airborne ? 1 : 0.2) + 0.05 * r.gauss()),
      gz: round2(gz),
      _h: heading,
    })
  }
  for (const s of imu) delete s._h

  const hr = []
  for (let t = 0; t <= duration; t++) {
    const sp = sampleAt(samples, t)
    const v = sp ? sp._v : 0
    const rise = 1 - Math.exp(-t / 95)
    const base = 78 + 62 * rise * clamp(v / (1000 / paceSecPerKm), 0.35, 1.25)
    hr.push({
      t,
      bpm: Math.round(clamp(base + 2.2 * Math.sin(t / 23) + 1.8 * r.gauss(), 62, 196)),
    })
  }

  const totalSteps = Math.round(stepSeries[stepSeries.length - 1] ?? 0)

  return {
    timescale: { start: 0, end: +duration.toFixed(2), hz, frames: imu.length },
    steps: {
      total: totalSteps,
      perMinute,
      perMinuteDelta,
      avgCadence: duration > 0 ? +((totalSteps / duration) * 60).toFixed(1) : 0,
      avgStride: totalSteps > 0 ? +(distanceOf(samples) / totalSteps).toFixed(3) : 0,
    },
    imu,
    heartRate: hr,
  }
}

function distanceOf(samples) {
  let d = 0
  for (let i = 1; i < samples.length; i++)
    d += haversine(samples[i - 1]._truth.lat, samples[i - 1]._truth.lng, samples[i]._truth.lat, samples[i]._truth.lng)
  return d
}

function sampleAt(samples, t) {
  if (!samples.length) return null
  let lo = 0
  let hi = samples.length - 1
  if (t <= samples[0].t) return samples[0]
  if (t >= samples[hi].t) return samples[hi]
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= t) lo = mid
    else hi = mid
  }
  return samples[lo]
}

function headingAt(samples, t) {
  const i = samples.indexOf(sampleAt(samples, t))
  const a = samples[Math.max(0, i - 1)]._truth
  const b = samples[Math.min(samples.length - 1, i + 1)]._truth
  return bearing(a.lat, a.lng, b.lat, b.lng)
}

const round2 = (v) => +v.toFixed(2)
