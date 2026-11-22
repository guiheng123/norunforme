import crypto from 'node:crypto'

const hmacSha1 = (key, data) => crypto.createHmac('sha1', key).update(data).digest('base64')
const md5b64 = (buf) => crypto.createHash('md5').update(buf).digest('base64')

export const RUN_RECORD_PREFIX = 'Public/Upload/file/run_record'

export function packTrackFile (points) {
  const key = Buffer.from('Wet2C8d34f62ndi3')
  const iv = Buffer.from('K6iv85jBD8jgf32D')
  const c = crypto.createCipheriv('aes-128-cbc', key, iv)
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(points), 'utf8')), c.final()])
  return ct.toString('base64').replace(/(.{76})/g, '$1\n') + '\n'
}

export async function ossPut (sts, objectKey, body, contentType = 'text/plain', callbackB64 = '') {
  const endpoint = String(sts.endpoint || 'oss-cn-hangzhou.aliyuncs.com').replace(/^https?:\/\//, '')
  const bucket = sts.bucket
  const token = sts.SecurityToken || sts.SenxrityToken || ''
  const date = new Date().toUTCString()
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')

  const ossHeaders =
    (callbackB64 ? `x-oss-callback:${callbackB64}\n` : '') +
    (token ? `x-oss-security-token:${token}\n` : '')
  const stringToSign = `PUT\n${md5b64(buf)}\n${contentType}\n${date}\n${ossHeaders}/${bucket}/${objectKey}`
  const signature = hmacSha1(sts.AccessKeySecret, stringToSign)
  const url = `https://${bucket}.${endpoint}/${objectKey}`
  const headers = {
    Authorization: `OSS ${sts.AccessKeyId}:${signature}`,
    Date: date,
    'Content-Type': contentType,
    'Content-MD5': md5b64(buf),
  }
  if (token) headers['x-oss-security-token'] = token
  if (callbackB64) headers['x-oss-callback'] = callbackB64

  const res = await fetch(url, { method: 'PUT', headers, body: buf })
  const text = await res.text()
  return {
    status: res.status,
    ok: res.status === 200 || res.status === 203,
    url,
    etag: res.headers.get('etag'),
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    body: text.slice(0, 200),
  }
}

export function callbackHeader (sts) {
  if (!sts || !sts.callback) return ''
  try {
    return Buffer.from(Buffer.from(sts.callback, 'base64').toString('utf8')).toString('base64')
  } catch {
    return ''
  }
}
