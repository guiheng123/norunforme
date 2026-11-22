export const SIG_SCHEMA = 'sig/1'
export const SIG_OWNER = 'guiheng123'
export const SIG_REPO = 'https://github.com/guiheng123/norunforme'
export const SIG_ALLOW = '禁止倒卖 / RESALE PROHIBITED'
export const SIG_DIGEST = '985d6fde59b65883cb55be25dbad62354818d2298335d268d8f976b97efc37ac'
export const SIG_SHORT = SIG_DIGEST.slice(0, 16)
export const SIG_TOKEN = `S1.${SIG_SHORT}`
export const SIG_PAYLOAD = 'lepao|guiheng123|https://github.com/guiheng123/norunforme|禁止倒卖 / RESALE PROHIBITED|sig/1'
export const MARK_SHORT = `${SIG_SCHEMA}|${SIG_SHORT}`
export const MARK_FULL = `${SIG_SCHEMA}|${SIG_SHORT}|${SIG_REPO}`

const B0 = '\u200b'
const B1 = '\u200c'
const SEP = '\u200d'
const OPEN = '\u2060'
const CLOSE = '\u2063'
const ALL = /[\u200b-\u200d\u2060-\u2063\ufeff]/g

export function encodeMarks (text: string): string {
  const bytes = new TextEncoder().encode(String(text ?? ''))
  let out = OPEN
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) out += (byte >> i) & 1 ? B1 : B0
    out += SEP
  }
  return out + CLOSE
}

export function decodeMarks (text: string): string[] {
  const s = String(text ?? '')
  const out: string[] = []
  let i = s.indexOf(OPEN)
  while (i >= 0) {
    const j = s.indexOf(CLOSE, i + 1)
    if (j < 0) break
    const body = s.slice(i + 1, j)
    const bytes: number[] = []
    let bits = ''
    for (const ch of body) {
      if (ch === B0) bits += '0'
      else if (ch === B1) bits += '1'
      else if (ch === SEP) {
        if (bits.length === 8) bytes.push(parseInt(bits, 2))
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍​‌‌‌‌‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​​‍​‌‌‌​‌​​‍​‌‌‌​​​​‍​‌‌‌​​‌‌‍​​‌‌‌​‌​‍​​‌​‌‌‌‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌​‌​​‌‍​‌‌‌​‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​‌‍​‌‌​​​‌​‍​​‌​‌‌‌​‍​‌‌​​​‌‌‍​‌‌​‌‌‌‌‍​‌‌​‌‌​‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌‌​‌​‌‍​‌‌​‌​​‌‍​‌‌​‌​​​‍​‌‌​​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌‌‍​​‌‌​​​‌‍​​‌‌​​‌​‍​​‌‌​​‌‌‍​​‌​‌‌‌‌‍​‌‌​‌‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌‌​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌​‌‌​‌‍​‌‌​​‌​‌‍⁣
        bits = ''
      }
    }
    if (bits.length === 8) bytes.push(parseInt(bits, 2))
    if (bytes.length) out.push(new TextDecoder().decode(new Uint8Array(bytes)))
    i = s.indexOf(OPEN, j + 1)
  }
  return out
}

export function stripMarks (text: string): string {
  return String(text ?? '').replace(ALL, '')
}

export function hasMarks (text: string): boolean {
  return decodeMarks(text).some((p) => p.includes(SIG_SHORT) || p.includes(SIG_REPO))
}

function tagCopy (): void {
  if (typeof document === 'undefined') return
  try {
    if (window.localStorage.getItem('lepao.trace') === '0') return
  } catch {
    /* 隐私模式 */
  }
  document.addEventListener('copy', (event) => {
    try {
      const sel = window.getSelection()?.toString() || ''
      if (!sel) return
      const clip = event.clipboardData
      if (!clip) return
      event.preventDefault()
      clip.setData('text/plain', `${stripMarks(sel)}\n${encodeMarks(MARK_SHORT)}`)
    } catch {
      /* 剪贴板被拒 */
    }
  })
}

async function checkServer (): Promise<void> {
  try {
    const r = await fetch('/api/meta', { headers: { Accept: 'application/json' } })
    if (!r.ok) return
    const body = await r.json()
    const server = body?.data?.sig
    if (server && server !== SIG_SHORT) {
      console.warn(`[lepao] 版本标识不一致：前端 ${SIG_SHORT} / 服务端 ${server}`)
    }
  } catch {
    /* 离线或 mock */
  }
}

export interface BuildIdentity {
  schema: string
  owner: string
  repo: string
  allow: string
  digest: string
  short: string
  token: string
  has: () => boolean
}

declare global {
  interface Window {
    __LEPAO_BUILD?: BuildIdentity
  }
}

export function initBuildTag (): BuildIdentity {
  const identity: BuildIdentity = {
    schema: SIG_SCHEMA,
    owner: SIG_OWNER,
    repo: SIG_REPO,
    allow: SIG_ALLOW,
    digest: SIG_DIGEST,
    short: SIG_SHORT,
    token: SIG_TOKEN,
    has: () => hasMarks(encodeMarks(MARK_FULL)),
  }

  if (typeof window === 'undefined') return identity

  window.__LEPAO_BUILD = identity
  document.documentElement.setAttribute('data-build', SIG_SHORT)

  if (!hasMarks(document.title)) document.title += encodeMarks(MARK_SHORT)

  try {
    document.head.appendChild(document.createComment(encodeMarks(MARK_FULL)))
  } catch {
    /* head 未就绪 */
  }

  console.log(
    `%c步道乐跑控制台%c  ${SIG_REPO}\n%c${SIG_OWNER} · ${SIG_ALLOW}`,
    'background:#16a34a;color:#fff;padding:2px 8px;border-radius:3px;font-weight:700',
    'color:#16a34a;font-weight:700',
    'color:#888',
  )

  tagCopy()
  void checkServer()

  return identity
}
