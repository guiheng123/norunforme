const SEEN_KEY = 'lepao.notice.v1'
const MUTE_KEY = 'lepao.notice.mute.v1'

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function local(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function flag(store: Storage | null, key: string): boolean {
  try {
    return store?.getItem(key) === '1'
  } catch {
    return false
  }
}

function put(store: Storage | null, key: string): void {
  try {
    store?.setItem(key, '1')
  } catch {
  }
}

function drop(store: Storage | null, key: string): void {
  try {
    store?.removeItem(key)
  } catch {
  }
}

export function noticeSeen(): boolean {
  return flag(session(), SEEN_KEY)
}

export function markNoticeSeen(): void {
  put(session(), SEEN_KEY)
}

export function noticeMuted(): boolean {
  return flag(local(), MUTE_KEY)
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
}

export function muteNotice(): void {
  put(local(), MUTE_KEY)
}

export function unmuteNotice(): void {
  drop(local(), MUTE_KEY)
}
