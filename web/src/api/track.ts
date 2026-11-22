export interface TrackPoint {
  a: number
  o: number
  s?: number
  p?: number
  b?: number
  c?: number
  l?: number
}

export interface Analysis {
  points: number
  distance: number
  rawDistance: number
  smoothDistance: number
  gpsNoisePct: number
  duration: number
  pace: string
  speed: { avg: number; max: number; std: number; min: number }
  maxAccel: number
  autocorr: number
  speedAutocorr: number
  stoppedRatio: number
  checkpointHits: number
  segments: number[]
  speedSeries: number[]
}

const R = 6371000
const rad = (d: number) => (d * Math.PI) / 180

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function trackLength(pts: TrackPoint[]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) {
    d += haversine(pts[i - 1].a, pts[i - 1].o, pts[i].a, pts[i].o)
  }
  return d
}

export function smooth(pts: TrackPoint[], window = 5): TrackPoint[] {
  const half = Math.floor(window / 2)
  return pts.map((p, i) => {
    let la = 0
    let lo = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(pts.length - 1, i + half); j++) {
      la += pts[j].a
      lo += pts[j].o
      n++
    }
    return { ...p, a: la / n, o: lo / n }
  })
}

function fmtPace(minPerKm: number): string {
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}'${String(s).padStart(2, '0')}"`
}

function segmentSpeeds(speeds: number[], n: number): number[] {
  const size = Math.ceil(speeds.length / n)
  const out: number[] = []
  for (let i = 0; i < speeds.length; i += size) {
    const chunk = speeds.slice(i, i + size)
    out.push(+(chunk.reduce((a, b) => a + b, 0) / chunk.length).toFixed(2))
  }
  return out
}

export function analyzeTrack(
  track: TrackPoint[],
  meta: { time?: number | string; distance?: number | string } = {},
): Analysis | null {
  const n = track.length
  if (n < 2) return null

  const speeds = track.map((p) => Number(p.s) || 0)
  const rawDist = trackLength(track)
  const sm = smooth(track, 5)
  const smoothDist = trackLength(sm)
  const duration = Number(meta.time) || 0
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  const serverDist = Number(meta.distance) || 0
  const totalDist = serverDist > 0 ? serverDist * 1000 : smoothDist

  const sAvg = speeds.reduce((a, b) => a + b, 0) / n
  const sMax = Math.max(...speeds)
  const variance = speeds.reduce((a, b) => a + (b - sAvg) ** 2, 0) / n
  const sStd = Math.sqrt(variance)

  const disp: number[] = []
  for (let i = 1; i < sm.length; i++) {
    disp.push(haversine(sm[i - 1].a, sm[i - 1].o, sm[i].a, sm[i].o))
  }
  const dMean = disp.reduce((a, b) => a + b, 0) / disp.length
  let num = 0
  let den = 0
  for (let i = 0; i < disp.length; i++) {
    den += (disp[i] - dMean) ** 2
    if (i > 0) num += (disp[i] - dMean) * (disp[i - 1] - dMean)
  }
  const autocorr = den > 0 ? num / den : 0

  const smSpeeds = sm.map((p) => Number(p.s) || 0)
  const sMean = smSpeeds.reduce((a, b) => a + b, 0) / smSpeeds.length
  let sNum = 0
  let sDen = 0
  for (let i = 0; i < smSpeeds.length; i++) {
    sDen += (smSpeeds[i] - sMean) ** 2
    if (i > 0) sNum += (smSpeeds[i] - sMean) * (smSpeeds[i - 1] - sMean)
  }
  const speedAutocorr = sDen > 0 ? sNum / sDen : 0

  const dt = duration > 0 && n > 1 ? duration / (n - 1) : 1
  const accs: number[] = []
  for (let i = 1; i < n; i++) accs.push(Math.abs(speeds[i] - speeds[i - 1]) / dt)
  const maxAcc = Math.max(...accs)

  const stopped = speeds.filter((s) => s < 0.3).length / n
  const checkpoints = track.filter((p) => p.p != null)
  const pace = totalDist > 0 && duration > 0 ? duration / 60 / (totalDist / 1000) : 0
  const gpsNoise = smoothDist > 0 ? rawDist / smoothDist - 1 : 0

  return {
    points: n,
    distance: +(totalDist / 1000).toFixed(2),
    rawDistance: +(rawDist / 1000).toFixed(2),
    smoothDistance: +(smoothDist / 1000).toFixed(2),
    gpsNoisePct: +(gpsNoise * 100).toFixed(1),
    duration,
    pace: pace > 0 ? fmtPace(pace) : '--',
    speed: {
      avg: +sAvg.toFixed(2),
      max: +sMax.toFixed(2),
      std: +sStd.toFixed(2),
      min: +Math.min(...speeds).toFixed(2),
    },
    maxAccel: +maxAcc.toFixed(2),
    autocorr: +autocorr.toFixed(3),
    speedAutocorr: +speedAutocorr.toFixed(3),
    stoppedRatio: +(stopped * 100).toFixed(1),
    checkpointHits: checkpoints.length,
    segments: segmentSpeeds(speeds, 10),
    speedSeries: speeds,
  }
}

export interface Check {
  name: string
  pass: boolean
  detail: string
  reference?: boolean
}

export interface Diagnosis {
  score: number
  verdict: string
  checks: Check[]
  issues: string[]
}

export function diagnose(a: Analysis, stepNum = 0): Diagnosis {
  const checks: Check[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail })

  add('最高速度', a.speed.max < 12, `${a.speed.max} m/s ${a.speed.max < 12 ? '正常' : '超过人类极限 12 m/s'}`)
  add('最大加速度', a.maxAccel < 10, `${a.maxAccel} m/s² ${a.maxAccel < 10 ? '正常' : '异常（超过 10）'}`)
  add('速度波动', a.speed.std > 0.1, `标准差 ${a.speed.std} ${a.speed.std > 0.1 ? '有自然波动' : '过于均匀'}`)
  add(
    '轨迹连续性',
    a.speedAutocorr > 0.2,
    `速度自相关 ${a.speedAutocorr} ${a.speedAutocorr > 0.2 ? '连续' : '跳变过多'}`,
  )
  add(
    'GPS噪声',
    a.gpsNoisePct >= 2 && a.gpsNoisePct <= 60,
    `原始/平滑距离偏差 ${a.gpsNoisePct}% ${
      a.gpsNoisePct >= 2 && a.gpsNoisePct <= 60
        ? '在真实 GPS 范围内'
        : a.gpsNoisePct < 2
          ? '过于干净（真实 GPS 不会这么平滑）'
          : '噪声过大'
    }`,
  )

  const paceSec = a.distance > 0 ? a.duration / a.distance : 0
  if (a.distance > 0 && a.duration > 0) {
    add(
      '配速',
      paceSec >= 180 && paceSec <= 540,
      `${a.pace} ${paceSec >= 180 && paceSec <= 540 ? "在 3'~9' 区间" : '超出合理区间'}`,
    )
  }

  if (stepNum > 0 && a.distance > 0) {
    const ratio = (a.distance * 1000) / (stepNum * 0.7)
    checks.push({
      name: '步幅比(参考)',
      pass: true,
      detail: `${ratio.toFixed(2)} —— step_num 疑似非真实步数，仅展示不计分`,
      reference: true,
    })
  }

  const scored = checks.filter((c) => !c.reference)
  const passed = scored.filter((c) => c.pass).length
  const score = Math.round((passed / scored.length) * 100)
  const issues = checks.filter((c) => !c.pass).map((c) => `${c.name}：${c.detail}`)

  let verdict: string
  if (score === 100) verdict = '特征与真实跑步一致'
  else if (score >= 80) verdict = '基本正常，有轻微异常项'
  else if (score >= 60) verdict = '存在多项异常，建议复核'
  else verdict = '多项特征异常，高度可疑'

  return { score, verdict, checks, issues }
}
