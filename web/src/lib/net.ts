import { reactive } from 'vue'

export const netState = reactive({
  offline: false,
  demo: false,
  apiBase: '',
  lastLiveAt: 0,
})

export function markLive() {
  netState.offline = false
  netState.demo = false
  netState.lastLiveAt = Date.now()
}

export function markMock() {
  if (netState.demo) return
  netState.offline = true
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
}

export function markDemo() {
  netState.demo = true
  netState.offline = false
}

export function setApiBase(base: string) {
  netState.apiBase = String(base ?? '').trim()
}
