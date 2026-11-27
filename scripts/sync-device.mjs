#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { parseMmkv, mmkvLast, valueAsNumber } from './lib/mmkv.mjs'
import { resolveAdb } from './lib/adb.mjs'
import { readRememberedFingerprint, rememberFingerprint, findHrefDeviceId } from './lib/auth.mjs'
import { dataRoot } from '../server/lib/paths.mjs'
import { LepaoClient } from '../server/lib/lp-client.mjs'

const PKG = 'com.lptiyu.tanke'
const ADB = resolveAdb()
const dry = process.argv.includes('--dry')
const serialArg = (() => {
  const i = process.argv.indexOf('--serial')
  return i > 0 ? process.argv[i + 1] : undefined
})()

const run = (args, enc = 'utf8') => new Promise((res) => {
  execFile(ADB, args, { maxBuffer: 1 << 28, encoding: 'buffer' }, (e, so, se) => {
    res({ ok: !e, out: so || Buffer.alloc(0), err: String(se || '') })
  })
})

async function pickSerial () {
  if (serialArg) return serialArg
  const r = await run(['devices'])
  const lines = r.out.toString('utf8').split(/\r?\n/).slice(1).filter((l) => /\sdevice\b/.test(l))
  const list = lines.map((l) => l.split(/\s+/)[0].trim()).filter(Boolean)
  if (!list.length) throw new Error('没有在线 adb 设备（先 adb connect <ip>:5555）')
  return list[0]
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
}

const serial = await pickSerial()
const sh = async (cmd) => (await run(['-s', serial, 'shell', cmd])).out
console.log(`设备：${serial}`)

async function readRemote (p) {
  let r = await run(['-s', serial, 'exec-out', `cat ${p}`])
  let buf = r.out
  const head = buf.subarray(0, 200).toString('utf8')
  if (!buf.length || /Permission denied|No such file|inaccessible/i.test(head)) {
    r = await run(['-s', serial, 'exec-out', `su -c "cat ${p}"`])
    buf = r.out
    const h2 = buf.subarray(0, 200).toString('utf8')
    if (!buf.length || /Permission denied|No such file|inaccessible/i.test(h2)) return null
  }
  return buf
}

const mmkvPath = `/data/data/${PKG}/files/mmkv/setting`
const buf = await readRemote(mmkvPath)
if (!buf) {
  console.error(`读不到 ${mmkvPath}：这台设备需要 root（KSU/Magisk）`)
  process.exit(1)
}
const parsed = parseMmkv(buf)
const get = (k) => mmkvLast(parsed.entries, k)

const token = String(get('access_token')?.str || '').trim()
const refresh = String(get('refresh_token')?.str || '').trim()
const uid = valueAsNumber(get('user_id'))
const schoolId = valueAsNumber(get('school_id'))
const studentNum = String(get('user_num')?.str || '').trim()
const termId = String(get('term_id')?.str || '').trim()
const zoneId = String(get('run_zone_id')?.str || '').trim()
const nick = String(get('user_nickname')?.str || '').trim()
const schoolName = String(get('school_name')?.str || '').trim()

console.log('MMKV 解析：', parsed.entries.length, '条记录')
console.log('  uid =', uid, ' 学号 =', studentNum, ' school_id =', schoolId, ' zone =', zoneId, ' term =', termId)
console.log('  token =', token ? token.slice(0, 8) + '…' + token.slice(-4) : '(没读到)')
if (!token || !uid) { console.error('token / uid 没取到，放弃'); process.exit(1) }

const getprop = async (k) => (await sh(`getprop ${k}`)).toString('utf8').trim()
const model = await getprop('ro.product.model')
const osVer = await getprop('ro.build.version.release')
const buildId = await getprop('ro.build.id')
const androidId = (await sh('settings get secure android_id')).toString('utf8').trim()

async function detectDeviceId () {
  const pat = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  const cmd = `grep -ra -o -i -E '${pat}' /data/data/${PKG}/ 2>/dev/null`
  let r = await run(['-s', serial, 'shell', cmd])
  let text = r.out.toString('utf8').toLowerCase()
  if (!/^[0-9a-f]{8}-/m.test(text)) {
    r = await run(['-s', serial, 'shell', `su -c "${cmd.replace(/"/g, '\\"')}"`])
    text = r.out.toString('utf8').toLowerCase()
  }
  const counts = new Map()
  for (const m of text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)) {
    if (/^00000000-0000-0000-0000-000000000000$/.test(m[0])) continue
    counts.set(m[0], (counts.get(m[0]) || 0) + 1)
  }
  const best = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || Number(/^00000000-/.test(b[0])) - Number(/^00000000-/.test(a[0])))[0]
  return best ? { value: best[0], hits: best[1] } : null
}

const detected = await detectDeviceId()
if (detected) console.log(`  App 数据目录里找到设备 id：${detected.value}（命中 ${detected.hits} 次）`)

let diskDeviceId = ''
try {
  const disk = JSON.parse(fs.readFileSync(path.join(dataRoot(), 'data', 'session.json'), 'utf8').replace(/^\uFEFF/, ''))
  const v = String(disk.mobileDeviceId || '').trim()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) && !/^00000000-0000-0000-0000-000000000000$/.test(v)) {
    diskDeviceId = v
    if (detected?.value !== v) console.log(`  沿用磁盘上已验证过的设备 id：${v}`)
  }
} catch {   }

const remembered = readRememberedFingerprint()
const href = await findHrefDeviceId({ serial }).catch(() => null)
if (href) console.log(`  WebView hrefstr 里的 mobileDeviceId：${href.value}（命中 ${href.count} 次，共 ${href.distinct} 个不同值）`)

const pad = (s) => String(s).padStart(8, '0')
const androidUuid = androidId.length === 16
  ? `${androidId.slice(0, 8)}-${androidId.slice(8, 12)}-${androidId.slice(12, 16)}-0000-000000000000`
  : ''
const candidates = [
  href ? { label: 'WebView hrefstr（App 实际发出的）', mobileDeviceId: href.value } : null,
  detected ? { label: 'App 数据目录里的 UUID', mobileDeviceId: detected.value } : null,
  remembered.mobileDeviceId && remembered.mobileDeviceId !== detected?.value
    ? { label: '本机记住的 UUID', mobileDeviceId: remembered.mobileDeviceId }
    : null,
  diskDeviceId && diskDeviceId !== detected?.value ? { label: '磁盘上验证过的 UUID', mobileDeviceId: diskDeviceId } : null,
  { label: '空串', mobileDeviceId: '' },
  { label: 'android_id 原样', mobileDeviceId: androidId },
  androidUuid ? { label: 'android_id → UUID 形态', mobileDeviceId: androidUuid } : null,
  { label: '模拟器固定 UUID', mobileDeviceId: '00000000-0000-0000-0000-000000000000' },
].filter(Boolean)

const base = { token, refresh_token: refresh || undefined, uid, school_id: schoolId, student_num: studentNum, mobileModel: model, mobileOsVersion: osVer, buildId }
let winner = null
for (const cand of candidates) {
  const c = new LepaoClient({ ...base, mobileDeviceId: cand.mobileDeviceId })
  const r = await c.keyed('Run2/beforeRunV260')
  const mark = r.status === 1 ? '✓' : '·'
  console.log(`  ${mark} ${cand.label.padEnd(22)} ${JSON.stringify(cand.mobileDeviceId).slice(0, 42).padEnd(44)} status=${r.status} ${String(r.info || '').slice(0, 26)}`)
  if (r.status === 1 && !winner) {
    winner = { ...cand, zone: r.dec?.run_zone_name, term: r.dec?.term_id, points: r.dec?.run_line_info?.point_list?.length }
  }
}

if (!winner) {
  console.error('\n所有候选都失败：token 多半已被手机端顶掉（102）或过期（101）。在手机上重新打开一次 App 再跑本脚本。')
  process.exit(2)
}
console.log(`\n选中：${winner.label}（${winner.mobileDeviceId || "''"}）  跑区 ${winner.zone}  term=${winner.term}  打卡点 ${winner.points}`)

if (dry) { console.log('（--dry 不写盘）'); process.exit(0) }

const FILE = path.join(dataRoot(), 'data', 'session.json')
let disk = {}
try { disk = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')) } catch { disk = {} }
const patch = {
  mobileModel: model,
  mobileDeviceId: winner.mobileDeviceId,
  mobileOsVersion: osVer,
  buildId,
  token,
  uid,
  school_id: schoolId,
  student_num: studentNum,
  ...(refresh ? { refresh_token: refresh } : {}),
  run_zone_id: zoneId || '1',
  term_id: termId || '1',
  ...(schoolName ? { school_name: schoolName } : {}),
  ...(nick ? { nick_name: nick } : {}),
  fp_source: winner.label,
  fp_verified_at: new Date().toISOString(),
  saved_at: new Date().toISOString(),
  source: `device:${serial}`,
}
const session = { ...disk, ...patch }
if (disk.token && String(disk.token) !== String(token)) {
  delete session.lpd3
  delete session.lp54
}
fs.mkdirSync(path.dirname(FILE), { recursive: true })
fs.writeFileSync(FILE, JSON.stringify(session, null, 2))
rememberFingerprint(session)
console.log(`已写入 ${FILE}（合并写，保留 ${Object.keys(disk).filter((k) => !(k in patch)).join('/') || '∅'}）`)
console.log(`指纹：${session.mobileModel} / ${session.mobileDeviceId || "''"} / ${session.mobileOsVersion}`)
