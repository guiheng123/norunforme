<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import UiModal from './ui/UiModal.vue'
import UiButton from './ui/UiButton.vue'
import notice from '../lib/notice.canonical.json'
import { markNoticeSeen, muteNotice, noticeMuted, noticeSeen } from '../lib/notice-state'

const props = withDefaults(defineProps<{ mode?: 'auto' | 'manual'; open?: boolean }>(), {
  mode: 'auto',
  open: false,
})

const emit = defineEmits<{ (e: 'close'): void; (e: 'action'): void }>()

const manual = computed(() => props.mode === 'manual')
const HOLD = manual.value
  ? Math.max(10000, Number(notice.manualHoldMs) || 10000)
  : Math.max(5000, Number(notice.holdMs) || 5000)

const autoOpen = ref(false)
const visible = computed(() => (manual.value ? props.open : autoOpen.value))
const ready = ref(false)
const left = ref(Math.ceil(HOLD / 1000))
let timer = 0

const ackShort = notice.ack.split(/[，,]/)[0] || '我已了解'

function tick (begin: number): void {
  const rest = HOLD - (Date.now() - begin)
  if (rest <= 0) {
    ready.value = true
    left.value = 0
    return
  }
  left.value = Math.ceil(rest / 1000)
  timer = window.setTimeout(() => tick(begin), 200)
}

function start (): void {
  window.clearTimeout(timer)
  ready.value = false
  left.value = Math.ceil(HOLD / 1000)
  if (!manual.value && typeof document !== 'undefined') document.documentElement.dataset.notice = '1'
  tick(Date.now())
}

function decide (): void {
  if (typeof window === 'undefined') return
  if (window.location.hash === '#notice-fallback') return
  if (noticeMuted()) return
  autoOpen.value = !noticeSeen()
}

function act (): void {
  if (!ready.value) return
  markNoticeSeen()
  if (manual.value) {
    muteNotice()
    emit('action')
    emit('close')
    return
  }
  autoOpen.value = false
}

function onlyClose (): void {
  if (!ready.value || !manual.value) return
  emit('close')
}

watch(visible, (on) => {
  if (on) start()
}, { immediate: true })

onBeforeUnmount(() => {
  window.clearTimeout(timer)
})

decide()
</script>

<template>
  <UiModal :open="visible" :title="notice.title" :width="620" :closable="false">
    <div class="notice">
      <section class="notice__sec">
        <h3 class="notice__h">{{ notice.disclaimer.head }}</h3>
        <ul class="notice__list">
          <li v-for="(item, i) in notice.disclaimer.items" :key="`d${i}`">{{ item }}</li>
        </ul>
      </section>

      <section class="notice__sec">
        <h3 class="notice__h">{{ notice.source.head }}</h3>
        <p class="notice__repo">
          <a :href="notice.repo" target="_blank" rel="noopener noreferrer">{{ notice.repo }}</a>
        </p>
        <p class="notice__hint">{{ notice.source.hint }}</p>
      </section>

      <section class="notice__sec">
        <h3 class="notice__h">{{ notice.prohibited.head }}</h3>
        <ol class="notice__list notice__list--num">
          <li v-for="(item, i) in notice.prohibited.items" :key="`p${i}`">{{ item }}</li>
        </ol>
        <p class="notice__hint">{{ notice.prohibited.hint }}</p>
      </section>

      <p class="notice__hint notice__tail">{{ manual ? notice.manual.note : notice.autoHint }}</p>
    </div>

    <template #footer>
      <span v-if="!ready" class="notice__wait">
        请阅读以上内容，{{ left }} 秒后可{{ manual ? '点「不再提醒」' : '继续' }}
      </span>
      <UiButton v-if="manual && ready" variant="secondary" size="sm" @click="onlyClose">
        {{ notice.manual.close }}
      </UiButton>
      <UiButton variant="primary" size="sm" :disabled="!ready" @click="act">
        <template v-if="manual">{{ ready ? notice.manual.ack : `${notice.manual.ack}（${left}s）` }}</template>
        <template v-else>{{ ready ? notice.ack : `${ackShort}（${left}s）` }}</template>
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.notice {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.notice__sec {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.notice__h {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.notice__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--c-text-2);
}

.notice__list li {
  position: relative;
  padding-left: 14px;
}

.notice__list li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 8px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--c-border-strong);
}

.notice__list--num {
  counter-reset: notice;
}

.notice__list--num li {
  padding-left: 20px;
  counter-increment: notice;
}

.notice__list--num li::before {
  content: counter(notice) '.';
  top: 0;
  left: 0;
  width: auto;
  height: auto;
  border-radius: 0;
  background: none;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--c-text-3);
}

.notice__repo {
  font-family: var(--font-mono);
  font-size: 12.5px;
  word-break: break-all;
}

.notice__repo a {
  text-decoration: none;
  border-bottom: 1px solid var(--c-primary-border);
}

.notice__repo a:hover {
  border-bottom-color: var(--c-primary);
}

.notice__hint {
  font-size: 12px;
  line-height: 1.65;
  color: var(--c-text-3);
}

.notice__tail {
  padding-top: 12px;
  border-top: 1px solid var(--c-border);
}

.notice__wait {
  margin-right: auto;
  font-size: 12px;
  color: var(--c-text-3);
}
</style>