

import { extractFromBuffer, mergeCandidates, buildCombo, scanPbStrings } from './lib/creds-scan.mjs'
import { normalizeSession, hasFingerprint, missingFingerprint } from './lib/auth.mjs'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

const TOKEN = '0123456789ABCDEF0123456789ABCDEF'
const UID = 10000001

function pbStr(s) {
  const b = Buffer.from(s, 'utf8')
  const len = []
  let n = b.length
  while (n >= 0x80) {
    len.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  len.push(n)
  return Buffer.concat([Buffer.from([0x0a, ...len]), b])
}

function mmkv(pairs) {
  const body = Buffer.concat(pairs.flatMap(([k, v]) => [pbStr(k), pbStr(v)]))
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length, 0)
  return Buffer.concat([head, body])
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
}

const mmkvBuf = mmkv([
  ['user_token', TOKEN],
  ['uid', String(UID)],
  ['student_num', '2026000000001'],
  ['school_id', '1'],
])

const xmlBuf = Buffer.from(
  `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
  <string name="token">${TOKEN}</string>
  <int name="uid" value="${UID}" />
  <string name="stu_num">2026000000001</string>
</map>`,
  'utf8',
)

const jsonBuf = Buffer.from(
  JSON.stringify({ code: 1, data: { token: TOKEN, user_id: UID, school_id: 1 } }),
  'utf8',
)

const looseBuf = Buffer.from(
  `I/LpHttp: resp={"token":"${TOKEN}","uid":${UID}} done`,
  'utf8',
)

const decoyBuf = Buffer.from('file md5 = 5d41402abc4b2a76b9719d911017c592', 'utf8')

const pb = scanPbStrings(mmkvBuf)
check('MMKV protobuf 串解析', pb.length >= 8, `${pb.length} 条`)

const a = extractFromBuffer(mmkvBuf, { source: 'files/mmkv/lepao' })
check('MMKV 提取 token', a.tokens.some((t) => t.value === TOKEN), `${a.tokens.length} 个候选`)
check('MMKV token 命中键名', a.tokens.find((t) => t.value === TOKEN)?.confidence === 'key')
check('MMKV 提取 uid', a.uids.some((u) => u.value === UID), JSON.stringify(a.uids.map((u) => u.value)))
check('MMKV 提取学号', a.studentNums.some((s) => s.value === '2026000000001'))
check('MMKV 提取 school_id', a.schoolIds.some((s) => s.value === 1))

const b = extractFromBuffer(xmlBuf, { source: 'shared_prefs/lp.xml' })
check('SharedPreferences 提取 token', b.tokens.some((t) => t.value === TOKEN))
check('SharedPreferences 提取 uid', b.uids.some((u) => u.value === UID), JSON.stringify(b.uids.map((u) => u.key)))

const c = extractFromBuffer(jsonBuf, { source: 'files/cache.json' })
check('JSON 提取 token', c.tokens.some((t) => t.value === TOKEN))
check('JSON 提取 user_id', c.uids.some((u) => u.value === UID))

const d = extractFromBuffer(looseBuf, { source: 'logcat' })
check('裸串兜底提取 token', d.tokens.some((t) => t.value === TOKEN))
check(
  '日志里的 token 被识别（键名或裸串）',
  ['key', 'raw'].includes(d.tokens.find((t) => t.value === TOKEN)?.confidence),
  d.tokens.find((t) => t.value === TOKEN)?.confidence,
)

const e = extractFromBuffer(decoyBuf, { source: 'decoy' })
check('小写 MD5 也会被扫成候选（在线校验负责剔除）', e.tokens.length === 1, e.tokens[0]?.confidence)

const merged = mergeCandidates([a, b, c, d])
check('合并去重', merged.tokens.filter((t) => t.value === TOKEN).length === 1)
check('键名命中优先', merged.tokens[0].confidence === 'key')

const combo = buildCombo(merged, { uid: UID })
check('只生成一个组合（不枚举）', !!combo, combo ? `token=${combo.token.slice(0, 8)}… uid=${combo.uid}` : '')
check('组合使用手动 uid', combo?.uid === UID)
check('不给 uid 就不出组合（不自动识别）', buildCombo(merged) === null)
check('不产生 token 变体（原值直出）', combo?.token === merged.tokens[0].value)

const s = normalizeSession({ token: TOKEN, uid: String(UID), school_id: '1', student_num: 2026000000001 })
check('uid 转数字', s.uid === UID)
check('school_id 转数字', s.school_id === 1)
check('student_num 保留字符串', s.student_num === '2026000000001')
check('不补默认指纹（mobileModel 保持缺失）', s.mobileModel === undefined, `实际=${String(s.mobileModel)}`)
check('不补默认指纹（mobileDeviceId 保持缺失）', s.mobileDeviceId === undefined, `实际=${String(s.mobileDeviceId)}`)
check('不补默认指纹（mobileOsVersion 保持缺失）', s.mobileOsVersion === undefined, `实际=${String(s.mobileOsVersion)}`)
check('缺指纹时 missingFingerprint 三项全报', missingFingerprint(s).length === 3, missingFingerprint(s).join(','))

const s2 = normalizeSession({ token: TOKEN, uid: String(UID), mobileModel: 'M1', mobileDeviceId: '', mobileOsVersion: '14' })
check('显式空 mobileDeviceId 被保留（空串是合法取值）', s2.mobileDeviceId === '', `实际=${String(s2.mobileDeviceId)}`)
check('给了 fingerprint 就完整通过', hasFingerprint(s2) === true)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
