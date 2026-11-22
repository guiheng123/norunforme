import { webcrypto } from 'node:crypto'
import { makeSign, aesDecrypt, AES_KEY, AES_IV } from './trackfile.mjs'

export const API = 'https://api2.lptiyu.com/v3/api.php'

const uaOf = (s) =>
  `Dalvik/2.1.0 (Linux; U; Android ${String(s.mobileOsVersion || '0').trim()}; ${String(s.mobileModel || 'unknown').trim()} Build/${String(s.buildId || '').trim() || 'unknown'})`

const enc = new TextEncoder()
const aesKey = await webcrypto.subtle.importKey('raw', enc.encode(AES_KEY), { name: 'AES-CBC' }, false, [
  'encrypt',
])

const directFetch = (url, init) => {
  const saved = {}
  for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NODE_USE_ENV_PROXY']) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  return fetch(url, init).finally(() => {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v
  })
}

export function baseParams(session, ostype = 1) {
  const p = {
    version: Number(process.env.LP_VERSION || 233),
    version_name: String(process.env.LP_VERSION_NAME || '4.3.3'),
    mobileModel: String(session.mobileModel ?? ''),
    mobileDeviceId: String(session.mobileDeviceId ?? ''),
    mobileOsVersion: String(session.mobileOsVersion ?? ''),
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    ostype: Number(ostype),
    student_num: String(session.student_num ?? ''),
    school_id: Number(session.school_id ?? 0),
    uid: Number(session.uid ?? 0),
    token: String(session.token ?? ''),
    timestamp: Math.floor(Date.now() / 1000),
    nonce: String(Math.floor(Math.random() * 900000 + 100000)),
    visit_uid: Number(session.uid ?? 0),
  }
  return p
}

async function parse(text) {
  const t = String(text ?? '').trim()
  if (!t) return { status: -3, info: '空响应', data: null }
  if (t.startsWith('<')) return { status: -1, info: '模块不存在（HTML）', data: null }
  let json
  try {
    json = JSON.parse(t)
  } catch {
    return { status: -2, info: `非 JSON：${t.slice(0, 80)}`, data: null }
  }
  let data = json.data
  if (json.is_encrypt && typeof data === 'string' && data) {
    try {
      json.data = data = JSON.parse(await aesDecrypt(data))
    } catch {
    }
  }
  return { status: json.status, info: json.info, data, raw: json }
}

const formBody = (o) =>
  new URLSearchParams(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]))).toString()

export function makeClient(session) {
  return async function call(mod, extra = {}) {
    const p = { ...baseParams(session, 1), ...extra }
    p.sign = makeSign(p)
    if (p.sign == null || p.sign === undefined) throw new Error('签名失败')
    const res = await directFetch(`${API}/${mod}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': uaOf(session),
      },
      body: formBody(p),
    })
    return parse(await res.text())
  }
}

export function makeClient5(session) {
  return async function call(mod, extra = {}) {
    const p = { ...baseParams(session, 5) }
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) p[k] = v
    }
    p.sign = makeSign(p)
    const ct = await webcrypto.subtle.encrypt(
      { name: 'AES-CBC', iv: enc.encode(AES_IV) },
      aesKey,
      enc.encode(JSON.stringify(p)),
    )
    const res = await directFetch(`${API}/${mod}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': uaOf(session),
      },
      body: `ostype=5&data=${encodeURIComponent(Buffer.from(ct).toString('base64'))}`,
    })
    return parse(await res.text())
  }
}
