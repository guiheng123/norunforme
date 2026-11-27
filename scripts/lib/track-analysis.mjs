import { webcrypto, createHash } from 'node:crypto'

export const AES_KEY = 'Wet2C8d34f62ndi3'
export const AES_IV = 'K6iv85jBD8jgf32D'
export const SIGN_KEY = 'rDJiNB9j7vD2'
export const API = `${String(process.env.LP_HOST || 'https://api2.lptiyu.com').replace(/\/+$/, '')}/v3/api.php`

const md5 = (s) => createHash('md5').update(s).digest('hex')
export const makeSign = (p) =>
  md5(
    Object.keys(p)
      .filter((k) => k !== 'sign')
      .sort()
      .map((k) => k + p[k])
      .join('') + SIGN_KEY,
  )

const enc = new TextEncoder()
const dec = new TextDecoder()

let aesKeyPromise = null
function aesKeyOf () {
  aesKeyPromise ??= webcrypto.subtle.importKey(
    'raw',
    enc.encode(AES_KEY),
    { name: 'AES-CBC' },
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    false,
    ['encrypt', 'decrypt'],
  )
  return aesKeyPromise
}

export async function aesDecrypt(b64) {
  const raw = Uint8Array.from(Buffer.from(b64, 'base64'))
  const pt = await webcrypto.subtle.decrypt(
    { name: 'AES-CBC', iv: enc.encode(AES_IV) },
    await aesKeyOf(),
    raw,
  )
  return dec.decode(pt)
}

export function makeClient(S) {
  return async function call(mod, extra = {}) {
    const p = {
      version: Number(process.env.LP_VERSION || 233),
      version_name: String(process.env.LP_VERSION_NAME || '4.3.3'),
      mobileModel: S.mobileModel ?? '',
      mobileDeviceId: S.mobileDeviceId ?? '',
      mobileOsVersion: S.mobileOsVersion ?? '',
      ostype: 1,
      student_num: S.student_num,
      school_id: S.school_id,
      uid: S.uid,
      token: S.token,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: String(Math.floor(Math.random() * 900000 + 100000)),
      visit_uid: S.uid,
      ...extra,
    }
    p.sign = makeSign(p)
    const body = new URLSearchParams(
      Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])),
    ).toString()

    const res = await fetch(`${API}/${mod}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': `Dalvik/2.1.0 (Linux; U; Android ${String(S.mobileOsVersion ?? '').trim() || '0'}; ${String(S.mobileModel ?? '').trim() || 'unknown'} Build/${String(S.buildId ?? '').trim() || 'unknown'})`,
        Connection: 'close',
      },
      body,
    })
    const text = await res.text()
    if (text.trim().startsWith('<')) return { status: -1, info: '服务器返回 HTML', data: null }
    const json = JSON.parse(text)
    let data = json.data
    if (json.is_encrypt && typeof json.data === 'string' && json.data) {
      data = JSON.parse(await aesDecrypt(json.data))
    }
    return { status: json.status, info: json.info, data }
  }
}

export async function fetchTrack(url) {
  const res = await fetch(url)
  const txt = (await res.text()).replace(/\s+/g, '')
  try {
    return JSON.parse(await aesDecrypt(txt))
  } catch {
    try {
      return JSON.parse(txt)
    } catch {
      return null
    }
  }
}

const R = 6371000
const rad = (d) => (d * Math.PI) / 180

export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function trackLength(pts) {
  let d = 0
  for (let i = 1; i < pts.length; i++) {
    d += haversine(pts[i - 1].a, pts[i - 1].o, pts[i].a, pts[i].o)
  }
  return d
}

export function trackLengthSmooth(pts, window = 5) {
  if (pts.length < window) return trackLength(pts)
  const sm = smooth(pts, window)
  return trackLength(sm)
}

export function smooth(pts, window = 5) {
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

export function displacements(pts) {
  const out = []
  for (let i = 1; i < pts.length; i++) {
    out.push(haversine(pts[i - 1].a, pts[i - 1].o, pts[i].a, pts[i].o))
  }
  return out
}

export async function collectCheckpoints(call, records) {
  const map = new Map()
  for (const r of records) {
    const det = await call('Run/recordDetailV270', {
      record_id: r.id,
      year_num: new Date().getFullYear(),
    })
    if (det.status !== 1) continue
    for (const p of det.data?.point_list ?? []) {
      const id = String(p.point_id)
      const prev = map.get(id)
      if (prev) prev.seen++
      else
        map.set(id, {
          id,
          lat: Number(p.latitude),
          lng: Number(p.longtitude),
          index: Number(p.point_index),
          seen: 1,
        })
    }
  }
  return [...map.values()].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
}

export function analyzeTrack(track, meta = {}) {
  const n = track.length
  if (n < 2) return null

  const speeds = track.map((p) => Number(p.s) || 0)
  const rawDist = trackLength(track)
  const smoothDist = trackLengthSmooth(track, 5)
  const duration = Number(meta.time) || 0
  const serverDist = Number(meta.distance) || 0

  const totalDist = serverDist > 0 ? serverDist * 1000 : smoothDist

  const sAvg = speeds.reduce((a, b) => a + b, 0) / n
  const sMax = Math.max(...speeds)
  const variance = speeds.reduce((a, b) => a + (b - sAvg) ** 2, 0) / n
  const sStd = Math.sqrt(variance)

  const sm = smooth(track, 5)
  const dispSpeeds = displacements(sm)

  const mean = dispSpeeds.reduce((a, b) => a + b, 0) / dispSpeeds.length
  let num = 0
  let den = 0
  for (let i = 0; i < dispSpeeds.length; i++) {
    den += (dispSpeeds[i] - mean) ** 2
    if (i > 0) num += (dispSpeeds[i] - mean) * (dispSpeeds[i - 1] - mean)
  }
  const autocorr = den > 0 ? num / den : 0

  const smSpeeds = smooth(track, 5).map((p) => Number(p.s) || 0)
  const sMean = smSpeeds.reduce((a, b) => a + b, 0) / smSpeeds.length
  let sNum = 0
  let sDen = 0
  for (let i = 0; i < smSpeeds.length; i++) {
    sDen += (smSpeeds[i] - sMean) ** 2
    if (i > 0) sNum += (smSpeeds[i] - sMean) * (smSpeeds[i - 1] - sMean)
  }
  const speedAutocorr = sDen > 0 ? sNum / sDen : 0

  const dt = duration > 0 && n > 1 ? duration / (n - 1) : 1
  const accs = []
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

function fmtPace(minPerKm) {
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}'${String(s).padStart(2, '0')}"`
}

function segmentSpeeds(speeds, n) {
  const size = Math.ceil(speeds.length / n)
  const out = []
  for (let i = 0; i < speeds.length; i += size) {
    const chunk = speeds.slice(i, i + size)
    out.push(+(chunk.reduce((a, b) => a + b, 0) / chunk.length).toFixed(2))
  }
  return out
}

export function diagnose(analysis, stepNum) {
  const issues = []
  const checks = []

  const add = (name, pass, detail) => {
    checks.push({ name, pass, detail })
    if (!pass) issues.push(`${name}：${detail}`)
  }

  add(
    '最高速度',
    analysis.speed.max < 12,
    `${analysis.speed.max} m/s ${analysis.speed.max < 12 ? '正常' : '超过人类极限 12 m/s'}`,
  )

  add(
    '最大加速度',
    analysis.maxAccel < 10,
    `${analysis.maxAccel} m/s² ${analysis.maxAccel < 10 ? '正常' : '异常（超过 10）'}`,
  )

  add(
    '速度波动',
    analysis.speed.std > 0.1,
    `标准差 ${analysis.speed.std} ${analysis.speed.std > 0.1 ? '有自然波动' : '过于均匀'}`,
  )

  add(
    '轨迹连续性',
    analysis.speedAutocorr > 0.2,
    `速度自相关 ${analysis.speedAutocorr} ${analysis.speedAutocorr > 0.2 ? '连续' : '跳变过多'}`,
  )

  if (analysis.gpsNoisePct != null) {
    add(
      'GPS噪声',
      analysis.gpsNoisePct >= 2 && analysis.gpsNoisePct <= 60,
      `原始/平滑距离偏差 ${analysis.gpsNoisePct}% ${
        analysis.gpsNoisePct >= 2 && analysis.gpsNoisePct <= 60
          ? '在真实 GPS 范围内'
          : analysis.gpsNoisePct < 2
            ? '过于干净（真实 GPS 不会这么平滑）'
            : '噪声过大'
      }`,
    )
  }

  const paceSec = analysis.distance > 0 ? analysis.duration / analysis.distance : 0
  if (analysis.distance > 0 && analysis.duration > 0) {
    add(
      '配速',
      paceSec >= 180 && paceSec <= 540,
      `${analysis.pace} ${paceSec >= 180 && paceSec <= 540 ? "在 3'~9' 区间" : '超出合理区间'}`,
    )
  }

  if (stepNum && stepNum > 0 && analysis.distance > 0) {
    const ratio = (analysis.distance * 1000) / (stepNum * 0.7)
    checks.push({
      name: '步幅比(参考)',
      pass: true,
      detail: `${ratio.toFixed(2)} —— 注意：step_num=${stepNum} 疑似非真实步数，此项仅展示不计分`,
      reference: true,
    })
  }

  const scored = checks.filter((c) => !c.reference)
  const passed = scored.filter((c) => c.pass).length
  const score = Math.round((passed / scored.length) * 100)

  let verdict
  if (score === 100) verdict = '特征与真实跑步一致'
  else if (score >= 80) verdict = '基本正常，有轻微异常项'
  else if (score >= 60) verdict = '存在多项异常，建议复核'
  else verdict = '多项特征异常，高度可疑'

  return { score, verdict, checks, issues }
}
