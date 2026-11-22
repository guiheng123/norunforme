import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const HOST = process.env.LP_HOST || 'https://api2.lptiyu.com'
const BASE = HOST + '/v3/api.php/'
const SALT = 'rDJiNB9j7vD2'
const REQ_KEY = Buffer.from('goMEzJ1pDpncNHb9')
const REQ_IV = Buffer.from('ZUrAS2lUidjyY2gK')
const RES_KEY = Buffer.from('Wet2C8d34f62ndi3')
const RES_IV = Buffer.from('K6iv85jBD8jgf32D')
export function buildUA (s = {}) {
  const model = String(s.mobileModel || '').trim() || 'unknown'
  const osVer = String(s.mobileOsVersion || '').trim() || '0'
  return `Dalvik/2.1.0 (Linux; U; Android ${osVer}; ${model} Build/${String(s.buildId || '').trim() || 'unknown'})`
}

export function hasFingerprint (s = {}) {
  return Boolean(
    String(s.mobileModel || '').trim() &&
      String(s.mobileOsVersion || '').trim() &&
      String(s.mobileDeviceId ?? '').trim(),
  )
}

export function missingFingerprint (s = {}) {
  const miss = []
  if (!String(s.mobileModel || '').trim()) miss.push('mobileModel')
  if (!String(s.mobileOsVersion || '').trim()) miss.push('mobileOsVersion')
  if (!String(s.mobileDeviceId ?? '').trim()) miss.push('mobileDeviceId（4.3.3 起必须是设备 UUID，空串会让服务端回 0 系统错误）')
  return miss
}

export function noFingerprintResult (miss) {
  const missing = miss || []
  return {
    status: -4,
    info: `缺少设备指纹：${missing.join('、')}`,
    missing,
    needFingerprint: true,
  }
}

export const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

export const sign = (p) => md5(
  Object.keys(p).filter((k) => k !== 'sign' && p[k] !== undefined && p[k] !== null).sort()
    .map((k) => k + p[k]).join('') + SALT,
)

export const KEY_SALT = 'eFoqdHOdDy6ViJ0i'
const unescapeJson = (s) => String(s).replace(/\\n/g, '\n').replace(/\\\//g, '/').replace(/\\\\/g, '\\')
export function signKey (p) {
  return md5(KEY_SALT + Object.keys(p)
    .filter((k) => k !== 'sign' && k !== 'mobileDeviceId' && p[k] !== undefined && p[k] !== null)
    .sort()
    .map((k) => k + unescapeJson(p[k])).join(''))
}

export function encryptKeyChannel (obj) {
  const c = crypto.createCipheriv('aes-128-cbc', REQ_KEY, REQ_IV)
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()])
  return ct.toString('base64').replace(/(.{76})/g, '$1\n') + '\n'
}
export function decryptKeyChannel (b64) {
  const d = crypto.createDecipheriv('aes-128-cbc', REQ_KEY, REQ_IV)
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8')
}
export function decryptResponse (b64) {
  const raw = String(b64).replace(/\\\//g, '/').replace(/\s+/g, '')
  const d = crypto.createDecipheriv('aes-128-cbc', RES_KEY, RES_IV)
  return Buffer.concat([d.update(Buffer.from(raw, 'base64')), d.final()]).toString('utf8')
}

export const CLIENT_VERSION = {
  version: Number(process.env.LP_VERSION || 233),
  version_name: String(process.env.LP_VERSION_NAME || '4.3.3'),
}

export function versionAtLeast (a, b) {
  const seg = (v) => String(v || '').split('.').map((x) => {
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    const n = parseInt(String(x).replace(/[^0-9]/g, ''), 10)
    return Number.isFinite(n) ? n : 0
  })
  const A = seg(a); const B = seg(b)
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? 0; const y = B[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

export class LepaoClient {
  constructor (session = {}) {
    const trim = (v) => (v === undefined || v === null ? undefined : String(v).trim())
    const fp = {
      mobileModel: trim(session.mobileModel) || undefined,
      mobileDeviceId: trim(session.mobileDeviceId),
      mobileOsVersion: trim(session.mobileOsVersion) || undefined,
      buildId: trim(session.buildId) || undefined,
    }
    this.s = {
      ostype: 1,
      ...session,
      ...fp,
      ...CLIENT_VERSION,
    }
    if (!this.s.student_num && this.s.uid) this.s.student_num = this.s.student_num || ''
  }

  requireFingerprint () {
    const miss = missingFingerprint(this.s)
    if (miss.length) {
      const e = new Error(
        `缺少设备指纹：${miss.join('、')}。服务端按 (token, uid, 设备指纹) 定位会话，缺失时一律返回 101。`,
      )
      e.code = 'NO_FINGERPRINT'
      e.missing = miss
      throw e
    }
    return this.s
  }

  get common () {
    const s = this.s
    return {
      version: s.version,
      version_name: s.version_name,
      mobileModel: s.mobileModel,
      mobileDeviceId: s.mobileDeviceId,
      mobileOsVersion: s.mobileOsVersion,
      ostype: s.ostype,
      student_num: s.student_num,
      school_id: s.school_id,
      uid: s.uid,
      token: s.token,
    }
  }

  get deviceParam () {
    const v = this.s.lp54 !== undefined && this.s.lp54 !== null ? this.s.lp54 : this.s.lpd3
    return v === undefined || v === null ? {} : { lp54: String(v) }
  }

  _body (extra, { keyChannel = false, withLpd3 = false } = {}) {
    const p = {
      ...this.common,
      ...(withLpd3 ? this.deviceParam : {}),
      timestamp: Math.floor(Date.now() / 1000),
      nonce: String(Math.floor(Math.random() * 900000) + 100000),
      ...extra,
    }
    if (keyChannel) {
      p.sign = signKey(p)
      return 'key=' + encodeURIComponent(encryptKeyChannel(p))
    }
    p.sign = sign(p)
    return new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString()
  }

  async _post (mod, body) {
    let lastErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this._postOnce(mod, body)
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 400 + attempt * 700))
      }
    }
    throw new Error(`网络错误（重试 3 次）：${lastErr && lastErr.message}`)
  }

  async _postOnce (mod, body) {
    const res = await fetch(BASE + mod, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': buildUA(this.s),
      },
      body,
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    let json
    try { json = JSON.parse(text.slice(text.indexOf('{'))) } catch { json = { status: -1, info: 'non-json', raw: text.slice(0, 200) } }
    if (json && json.is_encrypt && typeof json.data === 'string' && json.data) {
      try { json.dec = JSON.parse(decryptResponse(json.data)) } catch (e) { json.decError = String(e.message) }
    }
    return json
  }

  plain (mod, params = {}, opts = {}) {
    const miss = missingFingerprint(this.s)
    if (miss.length) return Promise.resolve(noFingerprintResult(miss))
    const p = {
      ...this.common,
      ...(opts.withLpd3 ? this.deviceParam : {}),
      timestamp: Math.floor(Date.now() / 1000),
      nonce: String(Math.floor(Math.random() * 900000) + 100000),
      ...params,
    }
    p.sign = opts.runSign ? signKey(p) : sign(p)
    return this._post(mod, new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString())
  }

  keyed (mod, params = {}, opts = {}) {
    const miss = missingFingerprint(this.s)
    if (miss.length) return Promise.resolve(noFingerprintResult(miss))
    return this._post(mod, this._body(params, { keyChannel: true, withLpd3: opts.withLpd3 !== false }))
  }

  async refreshToken () {
    const body = this._body({ refresh_token: this.s.refresh_token, access_token: this.s.token }, { keyChannel: true, withLpd3: true })
    const j = await this._post('Login/RefreshToken', body)
    if (j.dec?.access_token) {
      this.s.token = j.dec.access_token
      this.s.refresh_token = j.dec.refresh_token || this.s.refresh_token
    }
    return j
  }

  user () { return this.plain('User/User') }
  myZone (uid = this.s.uid) { return this.plain('User/myZone', { visit_uid: uid }) }
  index () { return this.plain('WpIndex/index') }
  terms () { return this.plain('WpRun/getTermList') }
  records (termId, page = 1) { return this.plain('WpRun/getTermRunRecord', { term_id: termId, page }) }
  recordDetail (recordId, yearNum) { return this.plain('Run/recordDetailV270', { record_id: recordId, year_num: yearNum }) }
  serverTime () { return this.plain('Run/getTimestampV278') }
  allZones () { return this.plain('Run/GetAllZone') }
  zonePoints (zoneId) { return this.plain('Run/GetZonePoints', { zone_id: zoneId }) }

  beforeRun () { return this.keyed('Run2/beforeRunV260') }
  setLocation ({ lat, lng, gameId = -1, pointIds = '' }) {
    return this.plain('Run/setRunLocationRecord', {
      latitude: Number(lat).toFixed(6),
      longitude: Number(lng).toFixed(6),
      game_id: gameId,
      point_ids: pointIds,
    }, { runSign: true, withLpd3: true })
  }
  async handshake ({ gameId = -1, pointIds = [] } = {}) {
    const ids = (pointIds || []).map(String).filter(Boolean)
    const r = await this.plain('Run/getTimestampV278', {
      game_id: String(gameId),
      point_ids: ids.join(','),
    })
    const d = r.dec || {}
    const str = d.str ? String(d.str) : ''
    if (str) this.s.runStr = str
    return {
      ...r,
      runStr: str,
      serverTs: Number(d.timestamp || 0),
      septal: Number(d.location_septal || 60),
      fixStr: d.fix_str || '',
    }
  }

  stopRun (params) {
    const runStr = this.s.runStr || this.s.lpd3
    return this.keyed('Run/stopRunV278', runStr ? { ...params, lpd3: runStr } : params)
  }
}

export function loadSession (file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}
export function saveSession (file, s) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(s, null, 2))
}
