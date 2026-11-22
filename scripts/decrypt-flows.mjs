import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'

const crypto = webcrypto
const AES_KEY = 'Wet2C8d34f62ndi3'
const AES_IV = 'K6iv85jBD8jgf32D'

const enc = new TextEncoder()
const dec = new TextDecoder()

const key = await crypto.subtle.importKey('raw', enc.encode(AES_KEY), { name: 'AES-CBC' }, false, [
  'encrypt',
  'decrypt',
])

export async function decryptB64(b64) {
  const raw = Uint8Array.from(Buffer.from(b64, 'base64'))
  const buf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: enc.encode(AES_IV) }, key, raw)
  return JSON.parse(dec.decode(buf))
}

export async function encryptObj(obj) {
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: enc.encode(AES_IV) },
    key,
    enc.encode(JSON.stringify(obj)),
  )
  return Buffer.from(buf).toString('base64')
}

const arg = process.argv[2]

if (!arg) {
  console.log(`用法：
  node scripts/decrypt-flows.mjs <base64密文>     解密单条
  node scripts/decrypt-flows.mjs --help

从 .mitm 文件批量提取 token 的推荐方式（用 mitmproxy 自带 Python）：
  mitmdump -nr flows.mitm -s scripts/extract_token.py
`)
  process.exit(0)
}

if (arg === '--help') {
  console.log(`
【推荐流程】

1. 抓包时保存 flows：
   mitmdump -p 8888 -w flows.mitm --ignore-hosts "..."

2. 用 mitmproxy 的 Python API 导出（mitmproxy 装好后自带 python）：
   mitmdump -nr flows.mitm -s scripts/extract_token.py
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣

3. extract_token.py 会打印所有 lptiyu 请求里解密出的 token / uid / school_id。

【直接解密单条】
   node scripts/decrypt-flows.mjs "U2FsdGVkX1+..."
`)
  process.exit(0)
}

try {
  const obj = await decryptB64(arg)
  console.log(JSON.stringify(obj, null, 2))
} catch (e) {
  console.error('解密失败：', e.message)
  process.exit(1)
}
