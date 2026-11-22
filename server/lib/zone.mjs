const VERSION_GATE_TEXT = '版本过低'

export function isVersionGate (r) {
  return Boolean(r && String(r.info || '').includes(VERSION_GATE_TEXT))
}

export function flattenZoneList (input) {
  const out = []
  const seen = new Set()
  const walk = (node, depth) => {
    if (!node || depth > 4 || out.length > 200) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    }
    if (typeof node !== 'object') return
    const id = node.id ?? node.zone_id ?? node.run_zone_id
    const name = node.name ?? node.zone_name ?? node.run_zone_name
    const schoolId = node.school_id ?? node.schoolId
    if (id !== undefined && id !== null && String(id).trim() && (name !== undefined || schoolId !== undefined)) {
      const key = String(id)
      if (!seen.has(key)) {
        seen.add(key)
        out.push({ id: key, name: name ? String(name) : '', school_id: schoolId })
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (!v || typeof v !== 'object') continue
      if (k === 'point_list' || k === 'run_line_info' || k === 'time_rule_arr') continue
      walk(v, depth + 1)
    }
  }
  walk(input, 0)
  return out
}

export function pointLatLng (x) {
  if (x && typeof x.jingwei === 'string' && x.jingwei.includes(',')) {
    const [lat, lng] = x.jingwei.split(',').map((v) => Number(String(v).trim()))
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
  }
  const lat = Number(x?.latitude ?? x?.lat)
  const lng = Number(x?.longtitude ?? x?.longitude ?? x?.lng)
  return { lat, lng }
}

export function mapZonePoints (points) {
  return (Array.isArray(points) ? points : [])
    .map((x) => {
      const { lat, lng } = pointLatLng(x)
      return {
        id: String(x?.point_id ?? x?.id ?? ''),
        name: String(x?.name ?? x?.address ?? x?.point_name ?? ''),
        lat,
        lng,
      }
    })
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
}

export async function resolveRunZone (c, s, beforeRunDec = {}) {
  const d = beforeRunDec || {}
  const candidates = []
  const add = (v) => {
    const t = String(v ?? '').trim()
    if (t && !candidates.includes(t)) candidates.push(t)
  }
  add(d.run_zone_id)
  add(s.zone_id)
  add(s.run_zone_id)

  let lastInfo = ''
  if (!candidates.length) {
    try {
      const r = await c.allZones()
      if (r && r.status === 1) {
        const list = flattenZoneList(r.dec ?? r.data ?? null)
        const bySchool = list.find((z) => s.school_id !== undefined && String(z.school_id ?? '') === String(s.school_id))
          || list.find((z) => z.name && s.school_name && z.name.includes(String(s.school_name)))
        if (bySchool) add(bySchool.id)
        else lastInfo = list.length ? `GetAllZone 里没有与 school_id=${s.school_id ?? '-'} 匹配的跑区` : 'GetAllZone 没返回跑区'
      } else {
        lastInfo = r?.info || `GetAllZone status=${r?.status}`
      }
    } catch (e) {
      lastInfo = `GetAllZone 失败：${e.message}`
    }
  }

  for (const id of candidates) {
    const zp = await c.zonePoints(id).catch((e) => ({ status: -2, info: e.message }))
    if (isVersionGate(zp)) return { ok: false, gate: zp, zoneId: id, points: [] }
    const points = mapZonePoints(zp?.dec?.point_list)
    if (points.length) return { ok: true, zoneId: id, points, info: '' }
    if (!lastInfo) lastInfo = String(zp?.info || 'GetZonePoints 返回空 point_list')
  }

  const fallback = mapZonePoints(d.run_line_info?.point_list)
  const zoneId = String(d.run_zone_id || candidates[0] || '')
  if (fallback.length) {
    return {
      ok: true,
      zoneId,
      points: fallback,
      info: `GetZonePoints 没给打卡点（${lastInfo || '空列表'}），改用 beforeRunV260 的 run_line_info`,
    }
  }
  return { ok: false, zoneId, points: [], info: lastInfo || 'GetZonePoints 与 beforeRunV260 都没有返回打卡点' }
}
