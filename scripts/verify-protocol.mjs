import { webcrypto } from 'node:crypto'

const crypto = webcrypto
const AES_KEY = 'Wet2C8d34f62ndi3'
const AES_IV = 'K6iv85jBD8jgf32D'
const SIGN_KEY = 'rDJiNB9j7vD2'
const API = 'https://api2.lptiyu.com/v3/api.php'

function md5(input) {
  const rotl = (x, n) => (x << n) | (x >>> (32 - n))
  const toBytes = (s) => {
    const u = unescape(encodeURIComponent(s))
    const o = []
    for (let i = 0; i < u.length; i++) o.push(u.charCodeAt(i))
    return o
  }
  const bytes = toBytes(input)
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 0; i < 8; i++) bytes.push((bitLen / Math.pow(2, 8 * i)) & 0xff)

  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]
  const K = []
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0

  for (let off = 0; off < bytes.length; off += 64) {
    const M = []
    for (let i = 0; i < 16; i++)
      M[i] =
        bytes[off + i * 4] |
        (bytes[off + i * 4 + 1] << 8) |
        (bytes[off + i * 4 + 2] << 16) |
        (bytes[off + i * 4 + 3] << 24)
    let A = a0,
      B = b0,
      C = c0,
      D = d0
    for (let i = 0; i < 64; i++) {
      let F, g
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
      F = (F + A + K[i] + M[g]) >>> 0
      A = D
      D = C
      C = B
      B = (B + rotl(F, S[i])) >>> 0
    }
    a0 = (a0 + A) >>> 0
    b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0
    d0 = (d0 + D) >>> 0
  }
  const hex = (n) => {
    let s = ''
    for (let i = 0; i < 4; i++) s += ((n >>> (8 * i)) & 0xff).toString(16).padStart(2, '0')
    return s
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}

function makeSign(p) {
  const ks = Object.keys(p)
    .filter((k) => k !== 'sign')
    .sort()
  let s = ''
  for (const k of ks) {
    const v = p[k]
    if (v == null) continue
    s += k + String(v)
  }
  return md5(s + SIGN_KEY)
}

let pass = 0,
  fail = 0
const check = (name, got, want) => {
  const ok = got === want
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n   期望 ${want}\n   实际 ${got}`}`)
  ok ? pass++ : fail++
}

console.log('=== 1. MD5 官方测试向量 ===')
check('MD5("")', md5(''), 'd41d8cd98f00b204e9800998ecf8427e')
check('MD5("abc")', md5('abc'), '900150983cd24fb0d6963f7d28e17f72')
check('MD5(fox)', md5('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6')

console.log('\n=== 2. AES-128-CBC 往返 ===')
const enc = new TextEncoder(),
  dec = new TextDecoder()
const key = await crypto.subtle.importKey('raw', enc.encode(AES_KEY), { name: 'AES-CBC' }, false, [
  'encrypt',
  'decrypt',
])
const payload = {
  uid: 123,
  token: 'TEST',
  school_id: 305,
  timestamp: 1700000000,
  version: 1,
  nonce: '123456',
  ostype: 5,
}
payload.sign = makeSign(payload)
const ct = await crypto.subtle.encrypt(
  { name: 'AES-CBC', iv: enc.encode(AES_IV) },
  key,
  enc.encode(JSON.stringify(payload)),
)
const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: enc.encode(AES_IV) }, key, ct)
check('加解密往返', JSON.stringify(JSON.parse(dec.decode(pt))), JSON.stringify(payload))

console.log('\n=== 3. 真实服务器连通性 ===')
async function call(mod) {
  const p = {
    uid: 0,
    token: '',
    school_id: 0,
    term_id: 0,
    course_id: 0,
    class_id: 0,
    student_num: '',
    card_id: '',
    timestamp: Math.floor(Date.now() / 1000),
    version: 1,
    nonce: String(Math.floor(Math.random() * 900000 + 100000)),
    ostype: 5,
  }
  p.sign = makeSign(p)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: enc.encode(AES_IV) },
    key,
    enc.encode(JSON.stringify(p)),
  )
  const b64 = Buffer.from(cipher).toString('base64')
  const res = await fetch(`${API}/${mod}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: 'ostype=5&data=' + encodeURIComponent(b64),
  })
  return res.json()
}

for (const m of ['WpIndex/index', 'WpRun/getTermList', 'Run2/beforeRunV260']) {
  try {
    const r = await call(m)
    check(`${m} → status=101（协议正确）`, String(r.status), '101')
    if (r.info) console.log(`   服务器说：${r.info}`)
  } catch (e) {
    console.log(`❌ ${m} 请求失败: ${e.message}`)
    fail++
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
