import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { md5, packTrack } from './trackfile.mjs'
import { makeClient, makeClient5 } from './channel.mjs'
import { STEPS, STEP_ORDER, PARAM_ERROR_HINTS, AUTH_HINTS } from './protocol.mjs'

export const API = 'https://api2.lptiyu.com/v3/api.php'

export const RUN_RECORD_PREFIX = 'Public/Upload/file/run_record'

export async function ossPut(sts, key, payloadBuffer) {
  const enc = new TextEncoder()
  const bucket = sts.bucket
  const endpoint = String(sts.endpoint ?? 'oss-cn-hangzhou.aliyuncs.com').replace(/^https?:\/\//, '')
  const date = new Date().toUTCString()
  const contentType = 'text/plain'
  const token = sts.SecurityToken

  const stringToSign =
    `PUT\n\n${contentType}\n${date}\n` +
    (token ? `x-oss-security-token:${token}\n` : '') +
    `/${bucket}/${key}`

  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      'HMAC',
      await webcrypto.subtle.importKey(
        'raw',
        enc.encode(sts.AccessKeySecret),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign'],
      ),
      enc.encode(stringToSign),
    ),
  ).toString('base64')

  const headers = {
    Authorization: `OSS ${sts.AccessKeyId}:${signature}`,
    Date: date,
    'Content-Type': contentType,
  }
  if (token) headers['x-oss-security-token'] = token

  const r = await fetch(`https://${bucket}.${endpoint}/${key}`, {
    method: 'PUT',
    headers,
    body: payloadBuffer,
  })
  let detail = ''
  if (!r.ok) detail = (await r.text()).slice(0, 160)
  return { ok: r.ok, status: r.status, key, detail }
}

export const isAuthFail = (r) =>
  r.status === 101 ||
  r.status === 102 ||
  AUTH_HINTS.some((h) => String(r.info ?? '').includes(h))

export const isNoEndpoint = (r) => r.status === -1

export const isParamError = (r) =>
  r.status !== 1 && !isNoEndpoint(r) && !isAuthFail(r) &&
  PARAM_ERROR_HINTS.some((h) => String(r.info ?? '').includes(h))

async function ossUpload(sts, fileName, payloadBuffer) {
  const url = sts.upload_url ?? sts.url ?? sts.put_url
  if (url) {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payloadBuffer,
    })
    return { url: String(url).split('?')[0], ok: r.ok, status: r.status }
  }

  if (sts.policy && (sts.signature || sts.sign)) {
    const host = sts.host ?? `https://${sts.bucket}.${sts.endpoint ?? 'oss-cn-hangzhou.aliyuncs.com'}`
    const key = `${sts.dir ?? 'run'}/${fileName}`
    const form = new FormData()
    form.append('key', key)
    form.append('policy', sts.policy)
    form.append('OSSAccessKeyId', String(sts.accessid ?? sts.accessKeyId ?? ''))
    form.append('signature', String(sts.signature ?? sts.sign))
    form.append('success_action_status', '200')
    const tok = sts.securityToken ?? sts.security_token
    if (tok) form.append('x-oss-security-token', String(tok))
    form.append('file', new Blob([payloadBuffer]), fileName)
    const r = await fetch(host, { method: 'POST', body: form })
    return { url: `${host}/${key}`, ok: r.ok, status: r.status }
  }

  const ak = sts.accessid ?? sts.accessKeyId ?? sts.AccessKeyId
  const sk = sts.accessKeySecret ?? sts.AccessKeySecret ?? sts.secret
  const token = sts.securityToken ?? sts.security_token ?? sts.SecurityToken
  const bucket = sts.bucket ?? sts.Bucket
  const endpoint = String(sts.endpoint ?? sts.Endpoint ?? 'oss-cn-hangzhou.aliyuncs.com')
    .replace(/^https?:\/\//, '')
  const dir = String(sts.dir ?? sts.prefix ?? 'run').replace(/^\/|\/$/g, '')
  if (!ak || !sk || !bucket) throw new Error(`OSS 凭证字段无法识别：${Object.keys(sts).join(',')}`)

  const key = `${dir}/${fileName}`
  const date = new Date().toUTCString()
  const contentType = 'application/octet-stream'
  const stringToSign = `PUT\n\n${contentType}\n${date}\n${
    token ? `x-oss-security-token:${token}\n` : ''
  }/${bucket}/${key}`
  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      'HMAC',
      await webcrypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(sk),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign'],
      ),
      new TextEncoder().encode(stringToSign),
    ),
  ).toString('base64')
  const headers = { Authorization: `OSS ${ak}:${signature}`, Date: date, 'Content-Type': contentType }
  if (token) headers['x-oss-security-token'] = token
  const r = await fetch(`https://${bucket}.${endpoint}/${key}`, {
    method: 'PUT',
    headers,
    body: payloadBuffer,
  })
  const publicUrl = sts.domain
    ? `${String(sts.domain).replace(/\/$/, '')}/${key}`
    : `https://${bucket}.${endpoint}/${key}`
  return { url: publicUrl, ok: r.ok, status: r.status }
}

export async function submitRun(o) {
  const {
    session,
    points,
    meta,
    stepNum = 0,
    zoneId = '',
    hits = [],
    dryRun = false,
    uploadTrack = false,
    useServerTime,
    cacheFile = 'protocol-cache.json',
    onLog = () => {},
  } = o

  const log = (step, label, state, detail = '') => onLog({ step, label, state, detail })
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}
  const persist = () => writeFileSync(cacheFile, JSON.stringify(cache, null, 2))

  const call = makeClient(session)
  const call5 = makeClient5(session)
  const packed = await packTrack(points)
  const fileName = `run_${meta.startTime}_${md5(JSON.stringify(points)).slice(0, 8)}.txt`

  const zone = await call('User/myZone')
  if (isAuthFail(zone)) {
    log('auth', '鉴权', 'fail', `status=${zone.status} ${zone.info ?? ''}`)
    return {
      ok: false,
      code: 3,
      reason: 'auth',
      status: zone.status,
      info: zone.info,
      hint: 'token 已失效（手机端重新登录会顶掉旧 token，反之亦然）。用 /sim/token 粘贴新 token。',
      fileName,
    }
  }
  log('auth', '鉴权', 'ok', zone.data?.user_info?.nick_name ?? '')

  let startTime = Number(meta.startTime)
  let endTime = Number(meta.startTime) + Number(meta.duration)
  let serverSkew = 0

  const ctx = {
    S: session,
    zoneId,
    zoneNum: Number.isFinite(Number(zoneId)) ? Number(zoneId) : 1,
    fileName,
    lat: points[0]?.a,
    lng: points[0]?.o,
    date: new Date(startTime * 1000).toISOString().slice(0, 10),
    yearNum: new Date(startTime * 1000).getFullYear(),
    startTime,
    endTime,
    meta,
    stepNum,
    hits,
  }
  const callFor = (step) => (step.channel === 5 ? call5 : call)

  const resolve = async (key) => {
    const step = STEPS[key]
    if (step.local) {
      log(key, step.label, 'skip', '本地动作，不发起请求')
      return { mod: null, local: true }
    }
    if (cache[key]) {
      if (step.candidates.includes(cache[key])) {
        log(key, step.label, 'cached', cache[key])
        return { mod: cache[key] }
      }
      log(key, step.label, 'stale', `缓存 ${cache[key]} 不在真实候选表内，重新探测`)
      delete cache[key]
      persist()
    }
    for (const mod of step.candidates) {
      const r = await callFor(step)(mod, step.build(ctx))
      if (isNoEndpoint(r)) {
        log(key, step.label, 'miss', `${mod} 不存在（服务端回 HTML）`)
        continue
      }
      if (isAuthFail(r)) {
        log(key, step.label, 'authfail', `status=${r.status} ${r.info ?? ''}`)
        return { mod: null, authFail: true }
      }
      cache[key] = mod
      persist()
      log(key, step.label, 'ok', `${mod}（status=${r.status} ${r.info ?? ''}）`)
      return { mod, resp: r }
    }
    log(key, step.label, 'fail', `候选全都不存在：${step.candidates.join(', ') || '(空)'}`)
    return { mod: null }
  }

  const before = await resolve('before')
  if (before.authFail) return { ok: false, code: 3, reason: 'auth', fileName }

  const needServerTime = useServerTime ?? true
  if (needServerTime) {
    const ts = await resolve('ts')
    const st = ts.resp?.data
    const svNow =
      typeof st === 'number' ? st : Number(st?.timestamp ?? st?.time ?? st?.now ?? NaN)
    if (Number.isFinite(svNow) && svNow > 1e9) {
      serverSkew = svNow - Math.floor(Date.now() / 1000)
      log('ts', '时间校准', 'ok', `服务端时间偏移 ${serverSkew}s`)
    }
  }

  await resolve('sim')

  if (hits.length) {
    const loc = await resolve('loc')
    if (loc.mod) {
      const lr = await call5(loc.mod, STEPS.loc.build(ctx))
      log(
        'loc',
        STEPS.loc.label,
        lr.status === 1 ? 'ok' : 'fail',
        `status=${lr.status} ${lr.info ?? ''}`,
      )
    }
  }

  let runRecordUrl = null
  if (uploadTrack) {
    const ossStep = await resolve('oss')
    const sts = ossStep.resp?.data
    if (sts?.AccessKeyId && sts?.AccessKeySecret) {
      try {
        const key = `Public/Upload/file/run_record/${meta.startTime}_${md5(packed.body).slice(0, 8)}.txt`
        const up = await ossPut(sts, key, Buffer.from(packed.body, 'utf8'))
        if (up.ok) {
          runRecordUrl = key
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
          log('oss', '轨迹上传 OSS', 'ok', `${(packed.bytes / 1024).toFixed(1)} KB → ${key}`)
        } else {
          log('oss', '轨迹上传 OSS', 'fail', `HTTP ${up.status} ${up.detail ?? ''}`)
        }
      } catch (e) {
        log('oss', '轨迹上传 OSS', 'fail', e.message)
      }
    } else {
      log('oss', '轨迹上传 OSS', 'skip', '没有拿到 STS')
    }
  }

  const packedB64 = packed.body.replace(/\s+/g, '')
  const stopCtx = { ...ctx, trackBody: packed.body, runRecordUrl }

  if (dryRun) {
    log('stop', '结束跑步', 'dry', 'dry-run：不联网')
    return {
      ok: true,
      code: 0,
      dryRun: true,
      fileName,
      bytes: packed.bytes,
      serverSkew,
      steps: STEP_ORDER.map((k) => {
        const s = STEPS[k]
        return {
          step: k,
          label: s.label,
          endpoint: s.local ? '(local)' : `${API}/${cache[k] ?? s.candidates[0]}`,
          channel: s.channel,
          body: s.local ? {} : s.build({ ...stopCtx, fileUrl: `https://OSS/${fileName}` }),
        }
      }),
    }
  }

  const stop = await resolve('stop')
  if (stop.authFail) return { ok: false, code: 3, reason: 'auth', fileName, fileUrl: packedB64 }

  let stopResp = null
  let recordId = null
  if (!stop.mod) {
    log('stop', '结束跑步', 'fail', '没有可用的结束端点')
    return { ok: false, code: 4, reason: 'endpoint', step: 'stop', fileName }
  }
  stopResp = await callFor(STEPS.stop)(stop.mod, STEPS.stop.build(ctx))
  recordId = stopResp.data?.record_id ?? stopResp.data?.id ?? null
  const stopOk = stopResp.status === 1
  log(
    'stop',
    '结束跑步',
    stopOk ? 'ok' : 'fail',
    `status=${stopResp.status} ${stopResp.info ?? ''}${recordId ? ` record_id=${recordId}` : ''}`,
  )

  if (!stopOk && isParamError(stopResp)) {
    return {
      ok: false,
      code: 6,
      reason: 'param',
      step: 'stop',
      fileName,
      response: { status: stopResp.status, info: stopResp.info, data: stopResp.data },
    }
  }

  log('upload', '上传跑步记录', 'skip', '无独立上传接口，轨迹已随 stop 提交')

  const ok = stopOk
  return {
    ok,
    code: ok ? 0 : 5,
    fileName,
    bytes: packed.bytes,
    recordId,
    serverSkew,
    stop: stopResp ? { status: stopResp.status, info: stopResp.info, data: stopResp.data } : null,
  }
}
