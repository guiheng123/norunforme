export const AES_KEY = 'Wet2C8d34f62ndi3'
export const AES_IV = 'K6iv85jBD8jgf32D'
export const SIGN_KEY = 'rDJiNB9j7vD2'
export const OSTYPE = 5

function md5(input: string): string {
  function rotl(x: number, n: number) {
    return (x << n) | (x >>> (32 - n))
  }
  function toBytes(str: string): number[] {
    const utf8 = unescape(encodeURIComponent(str))
    const out: number[] = []
    for (let i = 0; i < utf8.length; i++) out.push(utf8.charCodeAt(i))
    return out
  }
  const bytes = toBytes(input)
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 0; i < 8; i++) {
    bytes.push((bitLen / Math.pow(2, 8 * i)) & 0xff)
  }

  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]
  const K: number[] = []
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0

  for (let off = 0; off < bytes.length; off += 64) {
    const M: number[] = []
    for (let i = 0; i < 16; i++) {
      M[i] =
        bytes[off + i * 4] |
        (bytes[off + i * 4 + 1] << 8) |
        (bytes[off + i * 4 + 2] << 16) |
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
        (bytes[off + i * 4 + 3] << 24)
    }
    let A = a0,
      B = b0,
      C = c0,
      D = d0
    for (let i = 0; i < 64; i++) {
      let F: number, g: number
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

  const hex = (n: number) => {
    let s = ''
    for (let i = 0; i < 4; i++) {
      s += ((n >>> (8 * i)) & 0xff).toString(16).padStart(2, '0')
    }
    return s
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}

export { md5 }

const enc = new TextEncoder()
const dec = new TextDecoder()

async function importKey(raw: string) {
  return crypto.subtle.importKey('raw', enc.encode(raw), { name: 'AES-CBC' }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptPayload(obj: unknown): Promise<string> {
  const key = await importKey(AES_KEY)
  const data = enc.encode(JSON.stringify(obj))
  const buf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: enc.encode(AES_IV) }, key, data)
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

export async function decryptPayload<T = unknown>(b64: string): Promise<T> {
  const key = await importKey(AES_KEY)
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const buf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: enc.encode(AES_IV) }, key, raw)
  return JSON.parse(dec.decode(buf)) as T
}

export function hasWebCrypto(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle
}
