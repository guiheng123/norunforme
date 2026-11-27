#!/usr/bin/env node
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const GOOD = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ZERO = '00000000-0000-0000-0000-000000000000'
const REQ_KEY = Buffer.from('goMEzJ1pDpncNHb9')
const REQ_IV = Buffer.from('ZUrAS2lUidjyY2gK')

const seen = []
let reqCount = 0
const state = { mode: 'strict' }

function deviceIdOf (body) {
  const text = String(body || '')
  const form = new URLSearchParams(text)
  if (!form.has('key')) return { channel: 'plain', id: form.get('mobileDeviceId') }
  try {
    const d = crypto.createDecipheriv('aes-128-cbc', REQ_KEY, REQ_IV)
    const plain = Buffer.concat([d.update(Buffer.from(form.get('key'), 'base64')), d.final()]).toString('utf8')
    return { channel: 'key', id: JSON.parse(plain).mobileDeviceId }
  } catch {
    return { channel: 'key', id: null, bad: true }
  }
}

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    reqCount++
    const { channel, id } = deviceIdOf(body)
    seen.push(id)
    let out
    if (channel === 'plain') out = { status: 1, info: '', dec: { name: 't' } }
    else if (id === GOOD) out = { status: 1, info: '' }
    else if (id === '' || id === ZERO) out = state.mode === 'legacy' ? { status: 1, info: '' } : { status: 0, info: '系统错误' }
    else out = { status: 101, info: '登录信息失效，请重新登录' }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out))
  })
})
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const roots = []
const freshRoot = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-fp-verify-'))
  roots.push(d)
  process.env.LP_ROOT = d
  return d
}
freshRoot()
process.env.LP_HOST = `http://127.0.0.1:${port}`
process.env.LP_ADB_DEVICE = 'verify-fingerprint-no-device'
process.env.LP_ADB = 'verify-fingerprint-no-adb'

const { LepaoClient, noFingerprintResult } = await import('../server/lib/lp-client.mjs')
const { repairKeyedFingerprint, deviceIdCandidates, parseHrefDeviceIds, verifySession } = await import('./lib/auth.mjs')
const { keyedWithFingerprintRepair } = await import('../server/lib/submit.mjs')

const session = {
  token: 'T0KEN', uid: 10000001, school_id: 68, student_num: '2026000000001',
  mobileModel: 'TEST-MODEL-01', mobileOsVersion: '15', mobileDeviceId: '',
}

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name}${extra ? `  ← ${extra}` : ''}`) }
}

reqCount = 0
const r1 = await new LepaoClient(session).keyed('Run2/beforeRunV260')
check('keyed() 遇到空 mobileDeviceId 本地拦下（-4）', Number(r1.status) === -4, `status=${r1.status}`)
check('拦下时一个请求都没发出去', reqCount === 0, `reqCount=${reqCount}`)
check('-4 的文案给出取指纹的办法', /sync-device|import-har/.test(String(r1.info)), String(r1.info).slice(0, 80))

const p1 = await new LepaoClient(session).plain('User/User')
check('空串下明文通道照常（User/User=1）', Number(p1.status) === 1, `status=${p1.status}`)

const k1 = await new LepaoClient({ ...session, mobileDeviceId: GOOD }).keyed('Run2/beforeRunV260')
check('真值 → status 1', Number(k1.status) === 1, `status=${k1.status} ${k1.info || ''}`)
const k2 = await new LepaoClient({ ...session, mobileDeviceId: OTHER }).keyed('Run2/beforeRunV260')
check('别的 UUID → 101', Number(k2.status) === 101, `status=${k2.status}`)

reqCount = 0
const fix = await repairKeyedFingerprint(session, { scan: false, hrefDeviceId: GOOD })
check('repair 命中 href 候选', fix.ok === true, JSON.stringify(fix.tried))
check('repair 只打了一发就成功', reqCount === 1, `reqCount=${reqCount}`)
check('tried[0] 标了 verified', fix.tried[0]?.verified === true, JSON.stringify(fix.tried[0]))
check('tried[0] 带耗时（不再是 0 ms 假象）', Number.isFinite(fix.tried[0]?.ms), JSON.stringify(fix.tried[0]))

freshRoot()
reqCount = 0
const fixBad = await repairKeyedFingerprint(session, { scan: false, extra: [OTHER, '33333333-3333-4333-8333-333333333333'] })
check('全部 101 时把候选试完', fixBad.ok === false && fixBad.tried.filter((t) => t.status === 101).length === 2, JSON.stringify(fixBad.tried.map((t) => t.status)))
check('失败时带回上游文案与下一步提示', /101|sync-device/.test(String(fixBad.info) + String(fixBad.hint)), `${fixBad.info} | ${fixBad.hint}`)

freshRoot()
reqCount = 0
const fixCrash = await repairKeyedFingerprint(session, { scan: false })
check('status 0 立即早停（只试 1 个）', fixCrash.ok === false && fixCrash.tried.length === 1 && fixCrash.tried[0].status === 0, JSON.stringify(fixCrash.tried.map((t) => t.status)))

const rawHref = `junk&mobileDeviceId=${GOOD}&x=1 VERSION 1 ... mobileDeviceId=${ZERO} ... mobileDeviceId=${OTHER}`
const parsed = parseHrefDeviceIds(rawHref)
check('href 解析取最后一条并跳过全零', parsed.length === 2 && parsed[1] === OTHER, JSON.stringify(parsed))

const cands = deviceIdCandidates({ session: { ...session, mobileDeviceId: OTHER }, cands: { href: { value: GOOD }, deviceIds: [{ value: '33333333-3333-4333-8333-333333333333' }] } })
check('候选第 1 位是会话里的值', cands[0]?.value === OTHER, JSON.stringify(cands.map((c) => c.value)))
check('候选第 2 位是 href（并标 verified）', cands[1]?.value === GOOD && cands[1]?.verified === true, JSON.stringify(cands.map((c) => [c.value, !!c.verified])))

freshRoot()
reqCount = 0
const fakeClient = { s: { ...session }, keyed: async () => { reqCount++; return { status: 1 } } }
const out = await keyedWithFingerprintRepair(fakeClient, session)
check('submit 侧空串也没有首发请求', out.emptyId === true, `emptyId=${out.emptyId}`)
check('submit 侧返回 null 响应 + 失败修复', out.r === null && out.fix?.ok === false, JSON.stringify(out.fix?.tried?.map((t) => t.status)))
check('submit 侧修复耗时是实测值', Number.isFinite(out.ms) && out.ms >= 0, `ms=${out.ms}`)

const nf = noFingerprintResult(['mobileDeviceId'], { keyChannel: true })
check('noFingerprintResult 标 keyChannel 并给提示', nf.status === -4 && nf.keyChannel === true && /sync-device/.test(nf.info), nf.info)

freshRoot()
state.mode = 'strict'
const v1 = await verifySession(session, { retryFingerprint: false, keyedOracle: true })
check('4.3.3：明文能读但 key= 通道不过 → 判缺指纹（不落盘）', v1.ok === false && v1.needFingerprint === true && (v1.missing || []).includes('mobileDeviceId'), JSON.stringify({ ok: v1.ok, status: v1.status, missing: v1.missing }))
check('4.3.3：该结果带 keyVerified=false', v1.keyVerified === false, String(v1.keyVerified))

freshRoot()
const v2 = await verifySession(session, { retryFingerprint: false, keyedOracle: true, allowEmptyDeviceId: true })
check('显式 allowEmptyDeviceId 时保留旧行为（ok 但 keyVerified=false）', v2.ok === true && v2.keyVerified === false, JSON.stringify({ ok: v2.ok, keyVerified: v2.keyVerified }))

freshRoot()
state.mode = 'legacy'
const v3 = await verifySession({ ...session, version_name: '4.2.8' }, { retryFingerprint: false, keyedOracle: true })
check('4.2.x：空串 key= 通道能过 → 正常通过（不误伤）', v3.ok === true && v3.keyVerified === true, JSON.stringify({ ok: v3.ok, keyVerified: v3.keyVerified, status: v3.status }))
check('4.2.x：显式声明 4.2.8 时 keyed() 不拦空串', Number((await new LepaoClient({ ...session, version_name: '4.2.8' }).keyed('Run2/beforeRunV260')).status) === 1, '')
state.mode = 'strict'

server.close()
await new Promise((r) => setTimeout(r, 50))
for (const d of roots) fs.rmSync(d, { recursive: true, force: true })

console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
