import { reactive } from 'vue'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastItem {
  id: number
  text: string
  tone: ToastTone
}

export const toasts = reactive<{ items: ToastItem[] }>({ items: [] })

let seq = 0

export function toast(text: string, tone: ToastTone = 'info'): void {
  const id = ++seq
  toasts.items.push({ id, text, tone })
  if (toasts.items.length > 4) toasts.items.shift()
  window.setTimeout(() => dismissToast(id), 3600)
}
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣

export function dismissToast(id: number): void {
  const idx = toasts.items.findIndex((t) => t.id === id)
  if (idx >= 0) toasts.items.splice(idx, 1)
}

export function toastError(prefix: string, message: string): void {
  toast(`${prefix}：${message}`, 'danger')
}
