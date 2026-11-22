import crypto from 'node:crypto'

// 内容签名：把一段轻量标识编进零宽字符，散落在文件中间。
// 只做事后归因与完整性判断，不参与任何业务逻辑。
export const SIG_SCHEMA = 'sig/1'
export const SIG_ALLOW = '禁止倒卖 / RESALE PROHIBITED'
export const SIG_OWNER = 'guiheng123'
export const SIG_REPO = 'https://github.com/guiheng123/norunforme'
export const SIG_FILE = '.attest.json'

const CANON = ['lepao', SIG_OWNER, SIG_REPO, SIG_ALLOW, SIG_SCHEMA].join('|')
export const SIG_PAYLOAD = CANON
export const SIG_DIGEST = crypto.createHash('sha256').update(CANON, 'utf8').digest('hex')
export const SIG_SHORT = SIG_DIGEST.slice(0, 16)
export const SIG_TOKEN = 'S1.' + SIG_SHORT
export const MARK_SHORT = [SIG_SCHEMA, SIG_SHORT].join('|')
export const MARK_FULL = [SIG_SCHEMA, SIG_SHORT, SIG_REPO].join('|')

const B0 = '\u200b'
const B1 = '\u200c'
const SEP = '\u200d'
const OPEN = '\u2060'
const CLOSE = '\u2063'
const ALL = /[\u200b-\u200d\u2060-\u2063\ufeff]/g

export function encodeMarks (text) {
  const bytes = Buffer.from(String(text ?? ''), 'utf8')
  let out = OPEN
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) out += (byte >> i) & 1 ? B1 : B0
    out += SEP
  }
  return out + CLOSE
}

export function decodeMarks (text) {
  const s = String(text ?? '')
  const out = []
  let i = s.indexOf(OPEN)
  while (i >= 0) {
    const j = s.indexOf(CLOSE, i + 1)
    if (j < 0) break
    const body = s.slice(i + 1, j)
    const bytes = []
    let bits = ''
    for (const ch of body) {
      if (ch === B0) bits += '0'
      else if (ch === B1) bits += '1'
      else if (ch === SEP) { if (bits.length === 8) bytes.push(parseInt(bits, 2)); bits = '' }
    }
    if (bits.length === 8) bytes.push(parseInt(bits, 2))
    if (bytes.length) out.push(Buffer.from(bytes).toString('utf8'))
    i = s.indexOf(OPEN, j + 1)
  }
  return out
}

export function stripMarks (text) {
  return String(text ?? '').replace(ALL, '')
}

export function countMarks (text) {
  const m = String(text ?? '').match(/[\u200b-\u200d\u2060-\u2063]/g)
  return m ? m.length : 0
}

export function hasMarks (text) {
  return decodeMarks(text).some((p) => p.includes(SIG_SHORT) || p.includes(SIG_REPO))
}

export function readMark (text) {
  const list = decodeMarks(text)
  return list.find((p) => p.includes(SIG_SHORT)) || list[0] || null
}

//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍​‌‌‌‌‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​​‍​‌‌‌​‌​​‍​‌‌‌​​​​‍​‌‌‌​​‌‌‍​​‌‌‌​‌​‍​​‌​‌‌‌‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌​‌​​‌‍​‌‌‌​‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​‌‍​‌‌​​​‌​‍​​‌​‌‌‌​‍​‌‌​​​‌‌‍​‌‌​‌‌‌‌‍​‌‌​‌‌​‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌‌​‌​‌‍​‌‌​‌​​‌‍​‌‌​‌​​​‍​‌‌​​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌‌‍​​‌‌​​​‌‍​​‌‌​​‌​‍​​‌‌​​‌‌‍​​‌​‌‌‌‌‍​‌‌​‌‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌‌​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌​‌‌​‌‍​‌‌​​‌​‌‍⁣
// 只清掉零宽行被剥离后留下的空壳行，绝不碰块注释的收尾行
const MID_DEAD = new Set(['//', '<!---->', '<!-- -->', 'REM', '::'])
const TAIL_DEAD = new Set(['', '//', '/**/', '/*', '*/', '<!--', '-->', '<!---->', '<!-- -->', '#', 'REM', '::'])

function clean (text) {
  const lines = stripMarks(text).split('\n')
  const out = []
  for (const line of lines) {
    if (MID_DEAD.has(line.trim())) continue
    out.push(line)
  }
  while (out.length > 1 && TAIL_DEAD.has(out[out.length - 1].trim())) out.pop()
  return out
}

function markFor (ext, payload) {
  const marks = encodeMarks(payload)
  const e = String(ext || '').toLowerCase()
  if (['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '.cts'].includes(e)) return `//${marks}`
  if (e === '.css') return `/*${marks}*/`
  if (e === '.html' || e === '.htm' || e === '.xml') return `<!--${marks}-->`
  if (['.sh', '.bash', '.py', '.ps1', '.yml', '.yaml', '.toml'].includes(e)) return `# ${marks}`
  if (e === '.bat' || e === '.cmd') return `REM ${marks}`
  return marks
}

// 落点由相对路径决定：同一文件始终插在同一处，位置在文件中段，不碰首尾
export function placeMarks (text, ext, rel, payload = MARK_SHORT) {
  const lines = clean(text)
  const h = crypto.createHash('sha256').update(String(rel || ext || ''), 'utf8').digest()
  const span = Math.max(1, lines.length - 2)
  const at = 1 + (h.readUInt32BE(0) % span)
  lines.splice(at, 0, markFor(ext, payload))
  return lines.join('\n') + '\n'
}

export function ensureMarks (text, ext, rel, payload = MARK_SHORT) {
  return hasMarks(text) ? String(text) : placeMarks(text, ext, rel, payload)
}

export function injectAsset (rel, text) {
  const ext = String(rel).slice(String(rel).lastIndexOf('.'))
  const marks = encodeMarks(MARK_FULL)
  if (ext === '.html') return `${text}\n<!--${marks}-->`
  if (ext === '.js' || ext === '.css') return `${text}\n/*${marks}*/`
  return text
}

export function identity () {
  return {
    schema: SIG_SCHEMA,
    owner: SIG_OWNER,
    repo: SIG_REPO,
    allow: SIG_ALLOW,
    file: SIG_FILE,
    token: SIG_TOKEN,
    digest: SIG_DIGEST,
    short: SIG_SHORT,
    payload: SIG_PAYLOAD,
  }
}
