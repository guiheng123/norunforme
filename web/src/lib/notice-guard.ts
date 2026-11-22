import { NOTICE_FALLBACK, NOTICE_HOLD_MS } from './notice-fallback'
import { markNoticeSeen, noticeMuted, noticeSeen } from './notice-state'

const OVERLAY_ID = 'lp-notice-fallback'
const MARK_ATTR = 'notice'
const PROBE_MS = 1500
const TICK_MS = 200

type Sections = {
  readonly disclaimer: { readonly head: string; readonly items: readonly string[] }
  readonly source: { readonly head: string; readonly hint: string }
  readonly prohibited: { readonly head: string; readonly items: readonly string[]; readonly hint: string }
}

const COPY = NOTICE_FALLBACK as unknown as Sections & {
  readonly title: string
  readonly repo: string
  readonly owner: string
  readonly ack: string
  readonly autoHint: string
}

function appMounted (): boolean {
  try {
    return document.documentElement.dataset[MARK_ATTR] === '1'
  } catch {
    return false
  }
}

function box (tag: string, css: string): HTMLElement {
  const node = document.createElement(tag)
  node.style.cssText = css
  return node
}

function textBlock (head: string, items: readonly string[], hint?: string): HTMLElement {
  const wrap = box('div', 'display:flex;flex-direction:column;gap:6px')
  const h = box('div', 'font-size:13px;font-weight:600;color:#0f172a')
  h.textContent = head
  wrap.appendChild(h)

  const list = box('div', 'display:flex;flex-direction:column;gap:6px;font-size:12.5px;line-height:1.65;color:#475569')
  const ordered = head.includes('禁止')
  items.forEach((item, index) => {
    const row = box('div', 'position:relative;padding-left:' + (ordered ? '20px' : '14px'))
    const bullet = box('span', 'position:absolute;left:0;top:0;font-family:ui-monospace,monospace;font-size:11px;color:#94a3b8')
    bullet.textContent = ordered ? `${index + 1}.` : '•'
    const body = box('span', '')
    body.textContent = item
    row.appendChild(bullet)
    row.appendChild(body)
    list.appendChild(row)
  })
  wrap.appendChild(list)

  if (hint) {
    const note = box('div', 'font-size:12px;line-height:1.65;color:#94a3b8')
    note.textContent = hint
    wrap.appendChild(note)
  }
  return wrap
}

function removeFallback (): void {
  const node = document.getElementById(OVERLAY_ID)
  if (!node) return
  node.remove()
  try {
    document.body.style.overflow = ''
  } catch {
  }
}

function renderFallback (): void {
  if (document.getElementById(OVERLAY_ID)) return

  const hold = NOTICE_HOLD_MS >= 5000 ? NOTICE_HOLD_MS : 5000
  const overlay = box(
    'div',
    'position:fixed;inset:0;z-index:2000;display:flex;align-items:flex-start;justify-content:center;' +
      'padding:64px 24px 24px;background:rgba(15,23,42,.32);overflow-y:auto;' +
      'font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
  )
  overlay.id = OVERLAY_ID
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', COPY.title)

  const card = box(
    'div',
    'width:620px;max-width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:14px;' +
      'box-shadow:0 12px 40px rgba(15,23,42,.16);display:flex;flex-direction:column;max-height:calc(100vh - 96px)',
  )

  const head = box('div', 'display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid #e2e8f0')
  const title = box('div', 'font-size:14px;font-weight:600;color:#0f172a')
  title.textContent = COPY.title
  head.appendChild(title)
  card.appendChild(head)

  const body = box('div', 'display:flex;flex-direction:column;gap:16px;padding:16px;overflow-y:auto')
  body.appendChild(textBlock(COPY.disclaimer.head, COPY.disclaimer.items))

  const repoWrap = box('div', 'display:flex;flex-direction:column;gap:6px')
  const repoHead = box('div', 'font-size:13px;font-weight:600;color:#0f172a')
  repoHead.textContent = COPY.source.head
  const link = document.createElement('a')
  link.href = COPY.repo
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = COPY.repo
  link.style.cssText =
    'font-family:ui-monospace,monospace;font-size:12.5px;word-break:break-all;color:#16a34a;text-decoration:none;border-bottom:1px solid #86efac'
  const repoHint = box('div', 'font-size:12px;line-height:1.65;color:#94a3b8')
  repoHint.textContent = COPY.source.hint
  repoWrap.appendChild(repoHead)
  repoWrap.appendChild(link)
  repoWrap.appendChild(repoHint)
  body.appendChild(repoWrap)

  body.appendChild(textBlock(COPY.prohibited.head, COPY.prohibited.items, COPY.prohibited.hint))

  if (COPY.autoHint) {
    const tail = box('div', 'padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.65;color:#94a3b8')
    tail.textContent = COPY.autoHint
    body.appendChild(tail)
  }

  card.appendChild(body)

  const foot = box(
    'div',
    'display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0',
  )
  const wait = box('div', 'margin-right:auto;font-size:12px;color:#94a3b8')
  const button = document.createElement('button')
  button.type = 'button'
  button.disabled = true
  button.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;' +
    'border:1px solid #16a34a;border-radius:8px;background:#16a34a;color:#fff;font-size:12px;' +
    'font-weight:500;white-space:nowrap;opacity:.5;cursor:not-allowed'
  const shortAck = COPY.ack.split(/[，,]/)[0] || '我已了解'
  button.textContent = `${shortAck}（${Math.ceil(hold / 1000)}s）`
  foot.appendChild(wait)
  foot.appendChild(button)
  card.appendChild(foot)

  overlay.appendChild(card)
  document.body.appendChild(overlay)
  try {
    document.body.style.overflow = 'hidden'
  } catch {
  }

  const begin = Date.now()
  let timer = 0
  let ready = false

  const blockEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  document.addEventListener('keydown', blockEscape, true)

  const finish = (): void => {
    document.removeEventListener('keydown', blockEscape, true)
    window.clearTimeout(timer)
    markNoticeSeen()
    removeFallback()
  }

  const tick = (): void => {
    const left = hold - (Date.now() - begin)
    if (left <= 0) {
      ready = true
      button.disabled = false
      button.textContent = COPY.ack
      button.style.opacity = '1'
      button.style.cursor = 'pointer'
      wait.textContent = ''
      return
    }
    button.textContent = `${shortAck}（${Math.ceil(left / 1000)}s）`
    wait.textContent = `请阅读以上内容，${Math.ceil(left / 1000)} 秒后可继续`
    timer = window.setTimeout(tick, TICK_MS)
  }

  button.addEventListener('click', () => {
    if (!ready) return
    finish()
  })

  tick()
}

export function installNoticeGuard (): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (noticeSeen() || noticeMuted()) return

  if (window.location.hash === '#notice-fallback') {
    renderFallback()
    return
  }

  let timer = window.setTimeout(probe, PROBE_MS)

  function probe (): void {
    if (appMounted()) return
    renderFallback()
  }

  const stop = (): void => {
    observer.disconnect()
    window.clearTimeout(timer)
    timer = 0
    removeFallback()
  }

  const observer = new MutationObserver(() => {
    if (appMounted()) stop()
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-notice'] })
}
