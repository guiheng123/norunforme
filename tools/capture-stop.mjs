#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decryptKeyChannel } from '../server/lib/lp-client.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const FILE = arg('file', path.join(ROOT, 'analysis', 'flows.jsonl'))
const WATCH = args.includes('--watch')
const TARGETS = ['stopRunV278', 'stopFreeRunV220']

function scan (seen) {
  if (!fs.existsSync(FILE)) return []
  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean)
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  const found = []
  for (const line of lines) {
    let o; try { o = JSON.parse(line) } catch { continue }
    const p = o.path || ''
    if (!TARGETS.some((t) => p.includes(t))) continue
    const key = p + '|' + o.ts
    if (seen.has(key)) continue
    seen.add(key)
    const m = /(?:^|&)key=([^&]+)/.exec(o.reqBody || '')
    let payload = null
    if (m) {
      try { payload = JSON.parse(decryptKeyChannel(decodeURIComponent(m[1]))) } catch (e) { payload = { decrypt_error: e.message } }
    } else {
      payload = {}
      for (const kv of (o.reqBody || '').split('&')) {
        const i = kv.indexOf('=')
        if (i > 0) payload[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1))
      }
    }
    let res = null
    try {
      const rj = JSON.parse((o.resBody || '').slice((o.resBody || '').indexOf('{')))
      res = { status: rj.status, info: rj.info }
    } catch {}
    found.push({ ts: o.ts, path: p, payload, res })
  }
  return found
}

const seen = new Set()
function emit (rows) {
  for (const r of rows) {
    console.log('\n' + '='.repeat(90))
    console.log(new Date(r.ts).toISOString(), r.path, r.res ? JSON.stringify(r.res) : '')
    console.log(JSON.stringify(r.payload, null, 1).slice(0, 4000))
    const out = path.join(ROOT, 'analysis', 'stop-payload.json')
    fs.writeFileSync(out, JSON.stringify(r, null, 2))
    console.log('\n已写入', out)
    console.log('字段名：', Object.keys(r.payload || {}).join(', '))
  }
}

const first = scan(seen)
if (first.length) emit(first)
else console.log('（暂无 stopRunV278 / stopFreeRunV220 流量）')

if (WATCH) {
  console.log('继续监听', FILE, '… Ctrl+C 退出')
  setInterval(() => emit(scan(seen)), 3000)
}
