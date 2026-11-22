import { readFileSync, writeFileSync } from 'node:fs'
import { makeSign, SIGN_KEY } from './lib/trackfile.mjs'
import { installExitShim } from './lib/exit.mjs'

installExitShim()

const argv = process.argv.slice(2)
const arg = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d) : null
}

const file = arg('file')
const body = arg('body') ?? (file ? readFileSync(file, 'utf8') : null)
if (!body) {
  console.error('用法：node scripts/compare-request.mjs --file captured.txt')
  console.error('   或：node scripts/compare-request.mjs --body "version=228&..."')
  process.exit(2)
}

const rawInput = body.trim()

const sep = rawInput.match(/\r?\n\r?\n/)
const raw = sep ? rawInput.slice(sep.index + sep[0].length).trim() : rawInput

const headers = {}
if (sep) {
  for (const line of rawInput.slice(0, sep.index).split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
}

const params = {}
for (const [k, v] of new URLSearchParams(raw)) params[k] = v

const keys = Object.keys(params)
console.log('=== 请求体解析 ===\n')
if (sep) {
  console.log(`识别为完整 HTTP 报文：${rawInput.split(/\r?\n/)[0]}`)
  if (headers.cookie) console.log(`Cookie：${headers.cookie}`)
  console.log('')
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
}
console.log(`body 参数 ${keys.length} 个，${raw.length} 字节\n`)

const KEY_FIELDS = [
  'token',
  'uid',
  'visit_uid',
  'school_id',
  'student_num',
  'ostype',
  'version',
  'version_name',
  'mobileDeviceId',
  'mobileModel',
  'mobileOsVersion',
  'timestamp',
  'nonce',
  'sign',
]
for (const k of KEY_FIELDS) {
  if (params[k] !== undefined) console.log(`  ${k.padEnd(16)} = ${params[k]}`)
}
const others = keys.filter((k) => !KEY_FIELDS.includes(k))
if (others.length) console.log(`  其它：${others.join(', ')}`)

if (params.data && !params.token) {
  console.log('\n⚠ 这份请求体是 data=<base64> 形式（ostype=5 加密通道），明文里才有 token。')
  console.log('  用 scripts/lib/trackfile.mjs 的 aesDecrypt() 解开 data 后再看。')
  console.log('  原生 App 走的是 ostype=1 明文表单，抓那个更省事。')
}

console.log('\n=== 签名校验 ===\n')
const serverSign = params.sign
const calc = makeSign(params)
if (!serverSign) {
  console.log('请求体里没有 sign 字段')
} else if (calc === serverSign) {
  console.log(`✅ 重算与抓包一致：${calc}`)
  console.log(`   说明签名算法（key 升序拼接 + 盐 "${SIGN_KEY}"）没变`)
} else {
  console.log(`❌ 不一致`)
  console.log(`   抓包 sign = ${serverSign}`)
  console.log(`   本地重算 = ${calc}`)
  console.log('   可能：a) 盐变了  b) 排序规则变了  c) 有字段被排除/追加  d) 值被 URL 解码影响')
  const cand = keys.find((k) => k !== 'sign' && makeSign({ ...params, [k]: undefined }) === serverSign)
  if (cand) console.log(`   试出去掉 ${cand} 后能对上 —— 该字段可能不参与签名`)
}

const DEFAULT = {
  version: 233,
  version_name: '4.3.3',
  mobileModel: '',
  mobileDeviceId: '',
  mobileOsVersion: '',
  ostype: 1,
  student_num: '',
  school_id: 0,
  uid: 0,
  token: '',
  timestamp: Math.floor(Date.now() / 1000),
  nonce: '123456',
  visit_uid: 0,
}

const VOLATILE = new Set(['timestamp', 'nonce', 'sign'])
const missing = keys.filter((k) => DEFAULT[k] === undefined && k !== 'sign')
const extra = Object.keys(DEFAULT).filter((k) => params[k] === undefined)
const diff = keys.filter(
  (k) => DEFAULT[k] !== undefined && !VOLATILE.has(k) && String(DEFAULT[k]) !== String(params[k]),
)

console.log('\n=== 与脚本构造的差异 ===\n')
if (missing.length) console.log(`抓包有、脚本没有：${missing.join(', ')}`)
if (extra.length) console.log(`脚本有、抓包没有：${extra.join(', ')}`)
if (diff.length) {
  for (const k of diff) console.log(`值不同  ${k}: 脚本=${DEFAULT[k]}  抓包=${params[k]}`)
}
if (!missing.length && !extra.length && !diff.length) console.log('字段集合完全一致')

console.log('\n提示：timestamp / nonce / sign 每次都会变，属于正常差异。')

if (argv.includes('--save')) {
  if (!params.token || !params.uid) {
    console.error('\n✗ 抓包里没有 token 或 uid，无法保存')
    process.exit(2)
  }
  const session = {
    token: params.token,
    uid: Number(params.uid) || 0,
    school_id: Number(params.school_id) || 0,
    student_num: params.student_num ?? '',
    mobileDeviceId: params.mobileDeviceId ?? '',
    mobileModel: params.mobileModel ?? '',
    mobileOsVersion: params.mobileOsVersion ?? '',
    source: 'capture',
    saved_at: new Date().toISOString(),
  }
  const j = (v) => JSON.stringify(v, null, 2) + '\n'
  writeFileSync('creds.json', j(session), 'utf8')
  writeFileSync('session.json', j(session), 'utf8')
  console.log('\n✓ 已写入 creds.json / session.json')
  console.log(`  token=${session.token}`)
  console.log(`  uid=${session.uid}  school_id=${session.school_id}  student_num=${session.student_num}`)
  console.log('  直接从抓包取的值，未做任何额外请求。')
}
