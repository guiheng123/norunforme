<script setup lang="ts">
import { dismissToast, toasts } from '../../lib/toast'
</script>

<template>
  <Teleport to="body">
    <div class="toasts" role="status" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="item in toasts.items" :key="item.id" class="toast" :class="`toast--${item.tone}`">
          <span class="toast__dot" aria-hidden="true"></span>
          <span class="toast__text">{{ item.text }}</span>
          <button class="toast__x" type="button" aria-label="关闭" @click="dismissToast(item.id)">×</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 240px;
  max-width: 380px;
  padding: 10px 12px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.1);
  pointer-events: auto;
}

.toast__dot {
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--c-text-3);
  flex: 0 0 auto;
}

.toast--success .toast__dot {
  background: var(--c-success);
}

.toast--warning .toast__dot {
  background: var(--c-warning);
}

.toast--danger .toast__dot {
  background: var(--c-danger);
}

.toast--info .toast__dot {
  background: var(--c-primary);
}

.toast__text {
  flex: 1;
  font-size: 12px;
  line-height: 1.55;
  color: var(--c-text);
  word-break: break-word;
}

.toast__x {
  flex: 0 0 auto;
  color: var(--c-text-3);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}

.toast__x:hover {
  color: var(--c-text);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--t), transform var(--t);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
