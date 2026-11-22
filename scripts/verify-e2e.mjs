import { webcrypto, createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

const crypto = webcrypto
const AES_KEY = 'Wet2C8d34f62ndi3'
const AES_IV = 'K6iv85jBD8jgf32D'
const SIGN_KEY = 'rDJiNB9j7vD2'
const API = 'https://api2.lptiyu.com/v3/api.php'

const credPath = 'creds.json'
if (!existsSync(credPath)) {
  console.error(`缺少 ${credPath}，请先创建（格式见文件头部注释）`)
  process.exit(1)
}
const S = JSON.parse(readFileSync(credPath, 'utf8'))

const md5 = (s) => createHash('md5').update(s).digest('hex')
const makeSign = (p) =>
  md5(
    Object.keys(p)
      .filter((k) => k !== 'sign')
      .sort()
      .map((k) => k + p[k])
      .join('') + SIGN_KEY,
  )

const enc = new TextEncoder()
const dec = new TextDecoder()
const key = await crypto.subtle.importKey('raw', enc.encode(AES_KEY), { name: 'AES-CBC' }, false, [
  'encrypt',
  'decrypt',
])

async function aesDecrypt(b64) {
  const raw = Uint8Array.from(Buffer.from(b64, 'base64'))
  const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: enc.encode(AES_IV) }, key, raw)
  return dec.decode(pt)
}

async function call(mod, extra = {}) {
  const p = {
    version: 233,
    version_name: '4.3.3',
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
    },
    body,
  })
  const json = await res.json()
  let data = json.data
  if (json.is_encrypt && typeof json.data === 'string' && json.data) {
    try {
      data = JSON.parse(await aesDecrypt(json.data))
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    } catch {
      data = json.data
    }
  }
  return { status: json.status, info: json.info, data }
}

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

console.log('=== 步道乐跑 端到端验证 ===\n')

check('签名算法（MD5+盐）', makeSign({ a: 1, b: 2 }) === makeSign({ b: 2, a: 1 }), '顺序无关')

const z = await call('User/myZone')
check(
  'User/myZone',
  z.status === 1,
  z.status === 1 ? `昵称=${z.data?.user_info?.nick_name} 学校=${z.data?.user_info?.auth_status}` : z.info,
)

const idx = await call('WpIndex/index')
check('WpIndex/index', idx.status === 1, idx.status === 1 ? `${idx.data?.school_name}` : idx.info)

const tl = await call('WpRun/getTermList')
check('WpRun/getTermList', tl.status === 1 && Array.isArray(tl.data), `${tl.data?.length} 个学期`)

const term = tl.data?.[0]?.term_id
const rec = await call('WpRun/getTermRunRecord', { term_id: term, page: 1 })
check(
  'WpRun/getTermRunRecord',
  rec.status === 1,
  rec.status === 1
    ? `${rec.data?.total_num}条 / 有效${rec.data?.total_score_num}次 / ${rec.data?.total_score_distance}km`
    : rec.info,
)

const first = rec.data?.list?.[0]
if (first) {
  const det = await call('Run/recordDetailV270', {
    record_id: first.id,
    year_num: new Date().getFullYear(),
  })
  check('Run/recordDetailV270', det.status === 1, det.status === 1 ? det.data?.run_zone_name : det.info)

  if (det.status === 1 && det.data?.file) {
    try {
      const res = await fetch(det.data.file)
      const text = await res.text()
      let parsed
      try {
        parsed = JSON.parse(await aesDecrypt(text.trim()))
      } catch {
        parsed = JSON.parse(text)
      }
      check('轨迹文件解密', Array.isArray(parsed) && parsed.length > 0, `${parsed.length} 个点`)
      if (Array.isArray(parsed) && parsed[0]) {
        console.log(`   首点字段: ${Object.keys(parsed[0]).join(', ')}`)
        console.log(`   首点: ${JSON.stringify(parsed[0])}`)
      }
    } catch (e) {
      check('轨迹文件解密', false, e.message)
    }
  }
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
