import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { haversine } from './track-analysis.mjs'
import { makeClient, makeClient5 } from './channel.mjs'

export async function fetchZoneFromBeforeRun(session) {
  const call5 = makeClient5(session)
  const r = await call5('Run2/beforeRunV260', {})
  if (r.status !== 1 || !r.data) {
    const err = new Error(r.info || `beforeRun 失败 status=${r.status}`)
    err.code = r.status
    throw err
  }
  const d = r.data
  const line = d.run_line_info ?? {}
  const zone = (d.run_zone_list ?? [])[0] ?? {}
  const rule = (d.time_rule_arr ?? [])[0] ?? {}
  const points = (line.point_list ?? []).map((p, i) => {
    const [lat, lng] = String(p.jingwei ?? '').split(',').map(Number)
    return {
      no: i + 1,
      id: String(p.id),
      ids: [String(p.id)],
      lat,
      lng,
      seen: 1,
      name: p.address ?? `打卡点${i + 1}`,
      index: Number(p.index ?? i + 1),
    }
  })
  return {
    generatedAt: new Date().toISOString(),
    source: 'Run2/beforeRunV260',
    zone: {
      id: String(d.run_zone_id ?? zone.id ?? ''),
      name: d.run_zone_name ?? zone.name ?? '',
      point_type: d.point_type ?? '',
      log_mode: d.log_mode ?? '',
      log_logic: d.log_logic ?? 0,
    },
    term: { id: String(d.term_id ?? ''), date: d.term_date ?? '' },
    rules: {
      minDistanceKm: Number(rule.min_distance ?? 0),
      maxDistanceKm: Number(rule.max_distance ?? 0),
      minPaceSec: Number(rule.min_pace ?? 0),
      maxPaceSec: Number(rule.max_pace ?? 0),
      minLogNum: Number(rule.min_log_num ?? 0),
      minNum: Number(rule.min_num ?? 0),
      pointNumOnline: Number(rule.point_num_online ?? 0),
    },
    risk: {
      geetest: d.is_check_geetest ?? 0,
      deepknow: d.is_check_deepkonw ?? 0,
      device: d.is_check_device ?? 0,
      shumei: d.is_check_shumeng ?? 0,
      time: d.is_check_time ?? 0,
      capture: d.capture_config ?? {},
    },
    checkpoints: points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
  }
}

const norm = (c, i) => {
  const ids = c.ids ?? (Array.isArray(c.id) ? c.id : c.id != null ? String(c.id).split('/') : [])
  return {
    id: ids.length ? ids.join('/') : String(c.id ?? i + 1),
    ids: ids.map(String),
    lat: +c.lat,
    lng: +c.lng,
    seen: Number(c.seen ?? 0),
    name: c.name ?? `打卡点${i + 1}`,
    no: i + 1,
  }
}

export function loadLocalCheckpoints(files = ['checkpoints.json', 'route-plan.json']) {
  for (const f of files) {
    if (!existsSync(f)) continue
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'))
      const raw = j.checkpoints ?? j.route ?? []
      const list = raw.map(norm).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
      if (list.length) return { list, source: f, generatedAt: j.generatedAt ?? null }
    } catch {
    }
  }
  return { list: [], source: null, generatedAt: null }
}

export function loadCheckpointsFile(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'))
  const raw = j.checkpoints ?? (Array.isArray(j) ? j : [])
  return { list: raw.map(norm).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng)), source: file }
}

export async function fetchRemoteCheckpoints(session, opts = {}) {
  const { maxTerms = 3, maxRecords = 60, dedupM = 25, onProgress, preferZone = true } = opts
  const call = makeClient(session)
  const log = (m) => onProgress?.(m)

  if (preferZone) {
    try {
      const z = await fetchZoneFromBeforeRun(session)
      if (z.checkpoints.length) {
        log(`beforeRunV260 直接返回 ${z.checkpoints.length} 个打卡点`)
        return { ...z, scanned: 0, zones: [{ mod: 'Run2/beforeRunV260', summary: { zone: z.zone.name } }], terms: [z.term] }
      }
    } catch (e) {
      log(`beforeRunV260 不可用（${e.message}），回退历史记录聚合`)
    }
  }

  const zone = await call('User/myZone')
  if (zone.status !== 1) {
    const err = new Error(zone.info || `鉴权失败 status=${zone.status}`)
    err.code = zone.status
    throw err
  }
  const account = {
    nick: zone.data?.user_info?.nick_name ?? '',
    school: zone.data?.user_info?.school_name ?? '',
    uid: session.uid,
  }

  const tl = await call('WpRun/getTermList')
  if (tl.status !== 1 || !Array.isArray(tl.data)) throw new Error(`取学期失败：${tl.info}`)
  const terms = tl.data.slice(0, maxTerms)
  log(`学期 ${terms.length} 个`)

  const records = []
  for (const t of terms) {
    for (let page = 1; page <= 6; page++) {
      const r = await call('WpRun/getTermRunRecord', { term_id: t.term_id, page })
      if (r.status !== 1 || !r.data?.list?.length) break
      records.push(...r.data.list)
      if (r.data.list.length < 10 || records.length >= maxRecords) break
    }
    if (records.length >= maxRecords) break
  }
  log(`历史记录 ${records.length} 条`)

  const zoneCandidates = [
    'Run2/getRunZoneV270',
    'Run/getRunZoneV270',
    'WpRun/getRunZone',
    'Run/getRunZone',
    'Run2/getZonePointList',
    'Run/getZonePointList',
    'WpRun/getPointList',
  ]
  const zones = []
  for (const mod of zoneCandidates) {
    const r = await call(mod, { year_num: new Date().getFullYear() })
    if (r.status === 1 && r.data) {
      zones.push({ mod, summary: Array.isArray(r.data) ? { count: r.data.length } : { keys: Object.keys(r.data).slice(0, 10) } })
      log(`跑区接口命中 ${mod}`)
      break
    }
  }

  const byId = new Map()
  let scanned = 0
  for (const rec of records.slice(0, maxRecords)) {
    const det = await call('Run/recordDetailV270', {
      record_id: rec.id,
      year_num: new Date().getFullYear(),
    })
    scanned++
    if (dialogFailed(det)) continue
    for (const p of det.data?.point_list ?? []) {
      const id = String(p.point_id ?? p.id)
      const lat = Number(p.latitude ?? p.lat)
      const lng = Number(p.longtitude ?? p.longitude ?? p.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const prev = byId.get(id)
      if (prev) prev.seen++
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
      else byId.set(id, { id, lat, lng, seen: 1, name: p.point_name ?? p.name ?? null })
    }
    if (scanned % 10 === 0) log(`已扫 ${scanned}/${Math.min(records.length, maxRecords)}`)
  }

  const merged = []
  for (const cp of byId.values()) {
    const dup = merged.find((m) => haversine(m.lat, m.lng, cp.lat, cp.lng) < dedupM)
    if (dup) {
      dup.ids.push(cp.id)
      dup.seen += cp.seen
    } else merged.push({ ids: [cp.id], lat: cp.lat, lng: cp.lng, seen: cp.seen, name: cp.name })
  }

  const list = merged
    .sort((a, b) => b.seen - a.seen)
    .map((m, i) => ({
      no: i + 1,
      id: m.ids.join('/'),
      ids: m.ids,
      lat: +m.lat.toFixed(6),
      lng: +m.lng.toFixed(6),
      seen: m.seen,
      name: m.name ?? `打卡点${i + 1}`,
    }))

  return {
    generatedAt: new Date().toISOString(),
    account,
    terms: terms.map((t) => ({ id: t.term_id, name: t.term_name })),
    zones,
    scanned,
    checkpoints: list,
  }
}

const dialogFailed = (r) => !r || r.status !== 1

export function saveCheckpoints(payload, file = 'checkpoints.json') {
  writeFileSync(file, JSON.stringify(payload, null, 2))
  return file
}
