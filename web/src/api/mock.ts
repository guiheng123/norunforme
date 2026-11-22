import {
  currentDemoSchool,
  demoProfile,
  demoSchoolByInput,
  demoSession,
  type DemoSchool,
} from '../lib/demo'
import { analyzeTrack, haversine, trackLength, type Analysis, type TrackPoint } from './track'
import type {
  AdbConnectResult,
  DeviceRunCreated,
  DeviceRunState,
  DeviceStatus,
  DiagnosticItem,
  FridaDetail,
  HealthInfo,
  PreviewRequest,
  PreviewResponse,
  RecordDetail,
  RecordPage,
  RunRecord,
  SessionPayload,
  SubmitCreated,
  SubmitStatus,
  Term,
  TimeCheck,
  TrackBlock,
  TrackCheckpoint,
  TrackPointDTO,
  TrackStats,
  Verdict,
  ZonePayload,
} from './types'

const DT = 3

const RULES = {
  minDistanceKm: 1.5,
  maxDistanceKm: 10,
  minPaceSec: 540,
  maxPaceSec: 180,
  minLogNum: 2,
  pointNumOnline: 4,
  runStartTime: '04:00',
  runEndTime: '23:00',
  isCheckTime: true,
}

const TERMS: Term[] = [
  { term_id: '1', term_name: '2026-2027 学年第一学期', status: 'active' },
  { term_id: '2', term_name: '2025-2026 学年第二学期', status: 'closed' },
]

function schoolOf(ctx?: { query?: URLSearchParams; body?: Record<string, unknown> } | null): DemoSchool {
  const q = ctx?.query?.get('school')
  if (q) return demoSchoolByInput(q)
  const b = ctx?.body?.school
  if (b !== undefined && b !== null && String(b).trim() !== '') return demoSchoolByInput(b)
  return currentDemoSchool()
}

function zoneNameOf(school: DemoSchool): string {
  return school.zoneName || `${school.name} · 学生跑区`
}

function checkpointsOf(school: DemoSchool) {
  return school.checkpoints.map((cp) => ({ id: cp.id, name: cp.name, lat: cp.lat, lng: cp.lng }))
}

function sessionOf(school: DemoSchool) {
  return demoSession(school)
}

function profileOf(school: DemoSchool) {
  return demoProfile(school)
}

function clone<T>(v: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v)
    } catch {
    }
  }
  return JSON.parse(JSON.stringify(v)) as T
}

function prng(seed: number): () => number {
  let s = (seed || 1) >>> 0
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

function round(v: number, digits = 2): number {
  const p = Math.pow(10, digits)
  return Math.round(v * p) / p
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoAt(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}:${pad2(d.getSeconds())}`
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface GenOptions {
  targetKm: number
  paceSec: number
  seed: number
  startAt: number
}

interface GenResult extends TrackBlock {
  startAt: number
}

function generateTrack(opts: GenOptions, school: DemoSchool = currentDemoSchool()): GenResult {
  const targetM = Math.max(0.3, opts.targetKm) * 1000
  const baseSpeed = 1000 / Math.max(120, opts.paceSec)
  const rand = prng(opts.seed)
  const phase = rand() * Math.PI * 2
  const latM = 111320
  const lngM = 111320 * Math.cos((school.center.lat * Math.PI) / 180)
  const aM = school.rx * lngM
  const bM = school.ry * latM

  let theta = rand() * Math.PI * 2
  let driftLat = 0
  let driftLng = 0
  let traveled = 0
  let t = 0
  let guard = 0

  const points: TrackPointDTO[] = []
  const hit = new Set<string>()

  let prevLat = school.center.lat + school.ry * Math.sin(theta)
  let prevLng = school.center.lng + school.rx * Math.cos(theta)

  while (traveled < targetM && guard < 40000) {
    guard++
    const wave =
      1 +
      0.045 * Math.sin(t / 26 + phase) +
      0.022 * Math.sin(t / 9 + phase * 1.7) +
      (rand() - 0.5) * 0.018
    const speed = Math.max(0.6, baseSpeed * wave)

    driftLat = driftLat * 0.82 + (rand() - 0.5) * 0.0000125
    driftLng = driftLng * 0.82 + (rand() - 0.5) * 0.0000145

    const lat = round(school.center.lat + school.ry * Math.sin(theta) + driftLat, 6)
    const lng = round(school.center.lng + school.rx * Math.cos(theta) + driftLng, 6)

    const stepM = haversine(prevLat, prevLng, lat, lng)
    traveled += stepM
    prevLat = lat
    prevLng = lng

    const point: TrackPointDTO = { a: lat, o: lng, s: round(speed, 2) }

    school.checkpoints.forEach((cp, idx) => {
      if (hit.has(cp.id)) return
      if (haversine(lat, lng, cp.lat, cp.lng) <= 22) {
        hit.add(cp.id)
        point.p = idx + 1
      }
    })

    points.push(point)

    const arcPerRad = Math.sqrt((aM * Math.sin(theta)) ** 2 + (bM * Math.cos(theta)) ** 2)
    theta += (speed * DT) / Math.max(20, arcPerRad)
    t += DT

    if (points.length > 12000) break
  }

  if (points.length < 2) {
    points.push({ a: school.center.lat, o: school.center.lng + school.rx, s: round(baseSpeed, 2) })
  }

  const durationSec = Math.max(1, (points.length - 1) * DT)
  const analysis = analyzeTrack(points as TrackPoint[], { time: durationSec })
  const safe: Analysis = analysis ?? {
    points: points.length,
    distance: 0,
    rawDistance: 0,
    smoothDistance: 0,
    gpsNoisePct: 0,
    duration: durationSec,
    pace: '--',
    speed: { avg: 0, max: 0, std: 0, min: 0 },
    maxAccel: 0,
    autocorr: 0,
    speedAutocorr: 0,
    stoppedRatio: 0,
    checkpointHits: 0,
    segments: [],
    speedSeries: [],
  }

  const distanceKm = round(safe.distance, 2)
  const stats: TrackStats = {
    distanceKm,
    durationSec,
    paceSecPerKm: distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0,
    maxSpeed: round(safe.speed.max, 2),
    avgSpeed: durationSec > 0 ? round((distanceKm * 1000) / durationSec, 2) : 0,
    pointCount: points.length,
    noisePct: round(Math.abs(safe.gpsNoisePct), 1),
  }

  const paceSec = stats.paceSecPerKm
  const durationOk = durationSec >= 240 && durationSec <= 10800
  const noiseOk = stats.noisePct >= 1.2 && stats.noisePct <= 18

  const diagnostics: DiagnosticItem[] = [
    {
      key: 'pace',
      label: '配速区间',
      level: paceSec >= RULES.maxPaceSec && paceSec <= RULES.minPaceSec ? 'pass' : 'warn',
      value: `${Math.floor(paceSec / 60)}'${pad2(paceSec % 60)}"`,
      detail:
        paceSec >= RULES.maxPaceSec && paceSec <= RULES.minPaceSec
          ? '落在跑区允许的 3\'00" ~ 9\'00" 区间'
          : '超出跑区允许的配速区间，可能判无效',
    },
    {
      key: 'speed_std',
      label: '速度波动',
      level: safe.speed.std > 0.08 ? 'pass' : 'warn',
      value: `${round(safe.speed.std, 2)} m/s`,
      detail: safe.speed.std > 0.08 ? '存在自然起伏，符合真实跑动特征' : '速度过于均匀，特征偏机械',
    },
    {
      key: 'max_speed',
      label: '最高速度',
      level: safe.speed.max < 12 ? 'pass' : 'fail',
      value: `${round(safe.speed.max, 2)} m/s`,
      detail: safe.speed.max < 12 ? '未超过人类极限 12 m/s' : '超过人类极限，判定为异常轨迹',
    },
    {
      key: 'accel',
      label: '最大加速度',
      level: safe.maxAccel < 10 ? 'pass' : 'fail',
      value: `${round(safe.maxAccel, 2)} m/s²`,
      detail: safe.maxAccel < 10 ? '加减速连续，无跳变' : '存在瞬时跳变，加速度异常',
    },
    {
      key: 'autocorr',
      label: '轨迹连续性',
      level: safe.speedAutocorr > 0.2 ? 'pass' : safe.speedAutocorr > 0 ? 'warn' : 'fail',
      value: `${round(safe.speedAutocorr, 3)}`,
      detail:
        safe.speedAutocorr > 0.2
          ? '速度自相关 > 0.2，轨迹连贯'
          : safe.speedAutocorr > 0
            ? '速度自相关偏低，建议复核'
            : '速度自相关为负，轨迹跳变明显',
    },
    {
      key: 'gps_noise',
      label: 'GPS 噪声',
      level: noiseOk ? 'pass' : stats.noisePct < 1.2 ? 'warn' : 'fail',
      value: `${stats.noisePct}%`,
      detail: noiseOk
        ? '原始/平滑距离偏差在真实 GPS 范围内'
        : stats.noisePct < 1.2
          ? '过于平滑，真实设备不会如此干净'
          : '噪声过大，疑似轨迹拼接',
    },
    {
      key: 'duration',
      label: '时长合理性',
      level: durationOk ? 'pass' : 'warn',
      value: `${Math.floor(durationSec / 60)} 分 ${pad2(durationSec % 60)} 秒`,
      detail: durationOk ? '时长与里程、配速自洽' : '时长与里程不匹配，需人工复核',
    },
  ]

  const checkpoints: TrackCheckpoint[] = school.checkpoints.map((cp) => ({
    id: cp.id,
    lat: cp.lat,
    lng: cp.lng,
    name: cp.name,
    hit: hit.has(cp.id),
  }))

  return {
    points,
    checkpoints,
    stats,
    diagnostics,
    startAt: opts.startAt,
  }
}

function buildVerdict(diagnostics: DiagnosticItem[]): Verdict {
  const bad = diagnostics.filter((d) => d.level !== 'pass')
  return {
    pass: diagnostics.every((d) => d.level !== 'fail') && bad.filter((d) => d.level === 'warn').length <= 2,
    reasons: bad.map((d) => `${d.label}：${d.detail}`),
  }
}

function mockClock(ts: number): string {
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function mockTimeCheck(startAt: number, usedTime: number, startMode: 'now' | 'at'): TimeCheck {
  const now = Math.floor(Date.now() / 1000)
  const spanSlack = 115
  const wanted = Math.floor(startAt / 1000)
  const used = Math.max(60, Math.round(usedTime))
  const exact = startMode === 'at' && wanted > 0
  const startTs = exact ? wanted : now - used - spanSlack
  const endTs = exact ? wanted + used + spanSlack : now
  return {
    startAt: startTs,
    endAt: endTs,
    usedTime: used,
    spanSlack,
    startText: mockClock(startTs),
    endText: mockClock(endTs),
    mode: exact ? 'at' : 'now',
    note: exact
      ? `按「开始时间」${mockClock(startTs)} 起跑，${mockClock(endTs)} 停表`
      : `以当前时刻为锚倒推：${mockClock(startTs)} 起跑、${mockClock(endTs)} 停表`,
  }
}

interface RecordSeed {
  record: RunRecord
  seed: number
}

function buildRecords(): RecordSeed[] {
  const rand = prng(20261104)
  const out: RecordSeed[] = []
  const base = Date.now() - 2 * 3600 * 1000

  for (let i = 0; i < 23; i++) {
    const daysAgo = i * 2 + Math.floor(rand() * 2)
    const hour = 6 + Math.floor(rand() * 15)
    const start = new Date(base - daysAgo * 86400000)
    start.setHours(hour, Math.floor(rand() * 60), 0, 0)
    const km = round(1.6 + rand() * 3.6, 2)
    const paceSec = Math.round(300 + rand() * 130)
    const used = Math.round(km * paceSec)
    const statusRoll = rand()
    const status = statusRoll > 0.16 ? 1 : statusRoll > 0.07 ? 0 : 2
    const score = status === 1 ? Math.round(72 + rand() * 26) : Math.round(40 + rand() * 30)

    out.push({
      seed: hashString(`record-${i}`) || i + 7,
      record: {
        id: `R${260001 + i}`,
        start_time: isoAt(start.getTime()),
        end_time: isoAt(start.getTime() + used * 1000),
        distance: km,
        used_time: used,
        record_status: status,
        run_score: score,
        title: hour < 9 ? '晨间跑步' : hour < 15 ? '午间跑步' : hour < 19 ? '傍晚跑步' : '晚间跑步',
      },
    })
  }
  return out
}

const RECORDS = buildRecords()

function recordTotals(list: RunRecord[], all: RunRecord[]) {
  const valid = all.filter((r) => Number(r.record_status) === 1)
  return {
    total_num: all.length,
    total_score_num: valid.length,
    total_distance: round(
      all.reduce((a, r) => a + (Number(r.distance) || 0), 0),
      2,
    ),
    total_score_distance: round(
      valid.reduce((a, r) => a + (Number(r.distance) || 0), 0),
      2,
    ),
    list,
  }
}

function recordsForTerm(termId: string): RecordSeed[] {
  if (termId === '2') return RECORDS.slice(0, 9)
  return RECORDS
}

function detailForId(id: string, school: DemoSchool = currentDemoSchool()): RecordDetail {
  const found = RECORDS.find((r) => r.record.id === id)
  const seed = found?.seed ?? (hashString(id) || 1234)
  const startAt = found ? new Date(found.record.start_time).getTime() : Date.now() - 86400000
  const km = found?.record.distance ?? 3.2
  const used = found?.record.used_time ?? 1180
  const paceSec = Math.max(180, Math.min(540, Math.round(used / Math.max(0.5, km))))
  const track = generateTrack({ targetKm: km, paceSec, seed, startAt }, school)

  const record = found
    ? { ...found.record }
    : {
        id,
        start_time: isoAt(startAt),
        end_time: isoAt(startAt + used * 1000),
        distance: km,
        used_time: used,
        record_status: 1,
        run_score: 88,
        title: '历史记录',
      }

  return {
    record: {
      ...record,
      step_num: Math.round((track.stats.durationSec * 172) / 60),
      run_zone_name: zoneNameOf(school),
    },
    track: {
      points: track.points,
      checkpoints: track.checkpoints,
      stats: track.stats,
      diagnostics: track.diagnostics,
    },
  }
}

const submissions = new Map<string, { createdAt: number; verdict: Verdict }>()

const SUBMIT_STEPS: Array<{ step: string; label: string; ms: number; detail: string }> = [
  { step: 'session', label: '校验会话', ms: 42, detail: 'token / uid 有效，服务端返回 200' },
  { step: 'upload', label: '上传轨迹文件', ms: 268, detail: '轨迹已加密上传，OSS 返回 204' },
  { step: 'before', label: '开始跑步', ms: 312, detail: 'beforeRunV260 返回当前跑区与规则' },
  { step: 'points', label: '逐点注入轨迹', ms: 1240, detail: '按采样间隔上报全部轨迹点' },
  { step: 'end', label: '结束跑步', ms: 286, detail: 'endRun 返回记录 ID' },
  { step: 'verify', label: '回查记录', ms: 174, detail: '记录已入库，当前状态：待审核' },
]

//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
function submitStatusOf(id: string): SubmitStatus {
  const job = submissions.get(id)
  const createdAt = job?.createdAt ?? Date.now()
  const elapsed = Date.now() - createdAt
  const verdict: Verdict = job?.verdict ?? { pass: true, reasons: [] }

  let cursor = 0
  let done = 0
  for (const s of SUBMIT_STEPS) {
    cursor += s.ms
    if (elapsed >= cursor) done++
  }
  const finished = done >= SUBMIT_STEPS.length

  return {
    state: finished ? 'done' : 'running',
    steps: SUBMIT_STEPS.slice(0, Math.max(1, done)).map((s, i) => ({
      step: s.step,
      label: s.label,
      state: 'ok' as const,
      detail: i === SUBMIT_STEPS.length - 1 && !finished ? '等待响应…' : s.detail,
      ms: s.ms,
    })),
    verdict,
  }
}

const deviceRuns = new Map<
  string,
  { total: number; distanceKm: number; startedAt: number; stopped: boolean }
>()

function deviceRunState(id: string): DeviceRunState {
  const run = deviceRuns.get(id)
  if (!run) {
    return {
      id,
      state: 'failed',
      injected: 0,
      total: 0,
      distanceKm: 0,
      elapsedSec: 0,
      log: ['未找到该运行任务'],
    }
  }
  const elapsedMs = run.stopped ? 0 : Date.now() - run.startedAt
  const ratePerSec = Math.max(4, Math.ceil(run.total / 90))
  const injected = run.stopped
    ? Math.min(run.total, Math.round(run.total * 0.35))
    : Math.min(run.total, Math.floor((elapsedMs / 1000) * ratePerSec))
  const ratio = run.total > 0 ? injected / run.total : 0
  const state: DeviceRunState['state'] = run.stopped
    ? 'stopped'
    : injected >= run.total
      ? 'done'
      : 'running'

  const log: string[] = [`[adb] 已连接设备模拟器，开始注入 ${run.total} 个轨迹点`]
  const milestones = [0.25, 0.5, 0.75, 1]
  milestones.forEach((m, i) => {
    if (ratio >= m) {
      log.push(`[inject] 已注入 ${Math.round(run.total * m)} / ${run.total} 点（${Math.round(m * 100)}%）`)
    }
  })
  if (state === 'done') log.push('[done] 全部轨迹点注入完成')
  if (state === 'stopped') log.push('[stop] 收到停止指令，注入已中止')

  return {
    id,
    state,
    injected,
    total: run.total,
    distanceKm: round(run.distanceKm * ratio, 2),
    elapsedSec: Math.round(elapsedMs / 1000),
    log,
  }
}

interface Ctx {
  method: string
  pathname: string
  query: URLSearchParams
  body: Record<string, unknown>
}

type Handler = (ctx: Ctx) => unknown

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  {
    method: 'POST',
    pattern: /^\/api\/session$/,
    handler: (ctx) => {
      const school = schoolOf(ctx)
      return clone<SessionPayload>({ session: sessionOf(school), profile: profileOf(school) })
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/session$/,
    handler: (ctx) => {
      const school = schoolOf(ctx)
      return clone<SessionPayload>({ session: sessionOf(school), profile: profileOf(school), alive: true, status: 200 })
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/session$/,
    handler: () => ({
      cleared: true,
      hadSession: true,
      purged: [],
      fileRemoved: true,
      fileEmptied: false,
      fileExists: false,
    }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/session\/health$/,
    handler: (ctx) => {
      const school = schoolOf(ctx)
      return { alive: true, status: 1, info: `本地演示会话（${school.name}）` }
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/terms$/,
    handler: () => clone<Term[]>(TERMS),
  },
  {
    method: 'GET',
    pattern: /^\/api\/records$/,
    handler: (ctx) => {
      const termId = ctx.query.get('term_id') ?? TERMS[0].term_id
      const page = Math.max(1, Number(ctx.query.get('page') ?? 1) || 1)
      const pageSize = Math.max(1, Math.min(100, Number(ctx.query.get('pageSize') ?? 10) || 10))
      const all = recordsForTerm(termId).map((r) => r.record)
      const start = (page - 1) * pageSize
      const slice = all.slice(start, start + pageSize)
      return clone<RecordPage>(recordTotals(slice, all))
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/records\/([^/]+)$/,
    handler: (ctx) => {
      const id = decodeURIComponent(ctx.pathname.split('/').pop() ?? '')
      return clone<RecordDetail>(detailForId(id, schoolOf(ctx)))
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/zone$/,
    handler: (ctx) => {
      const school = schoolOf(ctx)
      return clone<ZonePayload>({
        zone: { id: school.zoneId, name: zoneNameOf(school) },
        rules: { ...RULES, minLogNum: school.minLogNum },
        checkpoints: checkpointsOf(school),
      })
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/track\/preview$/,
    handler: (ctx) => {
      const body = ctx.body as Partial<PreviewRequest>
      const school = schoolOf(ctx)
      const targetKm = Math.min(10, Math.max(1.5, Number(body.targetKm) || 3))
      const paceSec = Math.min(540, Math.max(180, Number(body.paceSec) || 330))
      const seed =
        body.seed === null || body.seed === undefined
          ? Math.floor(Math.random() * 900000) + 100000
          : Number(body.seed) || 1
      const startMs = body.startAt ? new Date(String(body.startAt)).getTime() : Date.now()
      const startAt = Number.isFinite(startMs) ? startMs : Date.now()
      const track = generateTrack({ targetKm, paceSec, seed, startAt }, school)
      const timeCheck = mockTimeCheck(startAt, track.stats.durationSec, body.startMode === 'at' ? 'at' : 'now')
      const resp: PreviewResponse = {
        points: track.points,
        checkpoints: track.checkpoints,
        stats: track.stats,
        diagnostics: track.diagnostics,
        verdict: buildVerdict(track.diagnostics),
        timeCheck,
      }
      return clone<PreviewResponse>(resp)
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/submit$/,
    handler: () => {
      const submitId = `sub_${Date.now().toString(36)}`
      submissions.set(submitId, {
        createdAt: Date.now(),
        verdict: { pass: true, reasons: [] },
      })
      return clone<SubmitCreated>({ submitId })
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/submit\/([^/]+)$/,
    handler: (ctx) => {
      const id = decodeURIComponent(ctx.pathname.split('/').pop() ?? '')
      return clone<SubmitStatus>(submitStatusOf(id))
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/device\/status$/,
    handler: () =>
      clone<DeviceStatus>({
        adb: true,
        serial: 'emulator-5554',
        devices: [{ serial: 'emulator-5554', state: 'device', model: 'SDY_AN00', tcp: true }],
        frida: true,
        fridaDetail: { ready: true, reason: 'ok', server: true, port: true, client: true, serverPid: 4242, appPid: 4243 },
        appForeground: 'com.lptiyu.run/.MainActivity',
        appPid: 4243,
        windowOpen: null,
        now: Date.now(),
        runWindow: [RULES.runStartTime, RULES.runEndTime],
        bridge: { up: false, port: 8790 },
      }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/device\/connect$/,
    handler: (ctx) =>
      clone<AdbConnectResult>({
        ok: true,
        target: String(ctx.body.host ?? 'emulator-5554'),
        text: 'demo: already connected',
        serial: 'emulator-5554',
      }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/device\/run$/,
    handler: (ctx) => {
      const points = Array.isArray(ctx.body.points) ? (ctx.body.points as unknown[]) : []
      const total = Math.max(points.length, 1)
      let km = 0
      if (points.length > 1) {
        const pts = points as TrackPoint[]
        km = round(trackLength(pts) / 1000, 2)
      }
      const runId = `run_${Date.now().toString(36)}`
      deviceRuns.set(runId, {
        total,
        distanceKm: km || 3.02,
        startedAt: Date.now(),
        stopped: false,
      })
      return clone<DeviceRunCreated>({ runId })
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/device\/run\/([^/]+)$/,
    handler: (ctx) => {
      const id = decodeURIComponent(ctx.pathname.split('/').pop() ?? '')
      return clone<DeviceRunState>(deviceRunState(id))
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/device\/run\/([^/]+)\/stop$/,
    handler: (ctx) => {
      const parts = ctx.pathname.split('/')
      const id = decodeURIComponent(parts[parts.length - 2] ?? '')
      const run = deviceRuns.get(id)
      if (run) run.stopped = true
      return { ok: true }
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/device\/devices$/,
    handler: () =>
      clone({
        ok: true,
        list: [{ serial: 'emulator-5554', state: 'device', model: 'SDY_AN00', tcp: true }],
        adbDetail: null,
      }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/device\/(probe|frida\/start|frida\/stop)$/,
    handler: () =>
      clone<FridaDetail>({
        ready: true,
        reason: 'demo: frida 未真正注入，仅演示状态',
        server: true,
        port: true,
        client: true,
        serverPid: 4242,
        appPid: 4243,
        serial: 'emulator-5554',
      }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/health$/,
    handler: () => ({ ok: true, version: '1.0.0-demo' }) as HealthInfo,
  },
]

export function mockResolve<T>(
  method: string,
  url: string,
  body: unknown,
): T | undefined {
  const raw = String(url ?? '')
  const qIndex = raw.indexOf('?')
  const pathname = qIndex >= 0 ? raw.slice(0, qIndex) : raw
  const query = new URLSearchParams(qIndex >= 0 ? raw.slice(qIndex + 1) : '')
  const ctx: Ctx = {
    method: method.toUpperCase(),
    pathname,
    query,
    body: body && typeof body === 'object' ? (body as Record<string, unknown>) : {},
  }

  for (const route of routes) {
    if (route.method !== ctx.method) continue
    if (!route.pattern.test(pathname)) continue
    try {
      return route.handler(ctx) as T
    } catch {
      return undefined
    }
  }
  return undefined
}
