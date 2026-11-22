<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    width?: number
    closable?: boolean
  }>(),
  { title: '', width: 560, closable: true },
)

const emit = defineEmits<{ (e: 'close'): void }>()

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.closable) emit('close')
}

function bind(open: boolean): void {
  if (typeof document === 'undefined') return
  if (open) {
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
  }
}

watch(
  () => props.open,
  (open) => bind(open),
  { immediate: true },
)

onBeforeUnmount(() => bind(false))
</script>

<template>
  <Teleport to="body">
    <Transition name="mask">
      <div v-if="open" class="mask" @click.self="closable && emit('close')">
        <div class="modal" :style="{ width: `${width}px` }" role="dialog" aria-modal="true">
          <header class="modal__head">
            <h2 class="modal__title">{{ title }}</h2>
            <button v-if="closable" class="modal__x" type="button" aria-label="关闭" @click="emit('close')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          <div class="modal__body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="modal__foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 64px 24px 24px;
  background: rgba(15, 23, 42, 0.32);
  overflow-y: auto;
}

.modal {
  max-width: 100%;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.16);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 96px);
}

.modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--c-border);
}

.modal__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text);
}

.modal__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--r-sm);
  color: var(--c-text-3);
  transition: background-color var(--t), color var(--t);
}

.modal__x:hover {
  background: #f1f5f9;
  color: var(--c-text);
}

.modal__body {
  padding: 16px;
  overflow-y: auto;
}

.modal__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
}

.mask-enter-active,
.mask-leave-active {
  transition: opacity var(--t);
}

.mask-enter-from,
.mask-leave-to {
  opacity: 0;
}
</style>
