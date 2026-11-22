<script setup lang="ts">
import { computed } from 'vue'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: 'sm' | 'md'
    disabled?: boolean
    loading?: boolean
    block?: boolean
    type?: 'button' | 'submit'
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    disabled: false,
    loading: false,
    block: false,
    type: 'button',
  },
)

const isDisabled = computed(() => props.disabled || props.loading)
</script>

<template>
  <button
    class="btn"
    :class="[`btn--${variant}`, `btn--${size}`, { 'btn--block': block, 'is-loading': loading }]"
    :type="type"
    :disabled="isDisabled"
  >
    <span v-if="loading" class="btn__spin" aria-hidden="true"></span>
    <span class="btn__label"><slot /></span>
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--r);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color var(--t), border-color var(--t), color var(--t);
  user-select: none;
}

.btn--sm {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}

.btn--block {
  display: flex;
  width: 100%;
}

.btn--primary {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #ffffff;
}

.btn--primary:hover:not(:disabled) {
  background: var(--c-primary-hover);
  border-color: var(--c-primary-hover);
}

.btn--secondary {
  background: var(--c-surface);
  border-color: var(--c-border);
  color: var(--c-text);
}

.btn--secondary:hover:not(:disabled) {
  background: var(--c-surface-2);
  border-color: var(--c-border-strong);
}

.btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--c-text-2);
}

.btn--ghost:hover:not(:disabled) {
  background: #f1f5f9;
  color: var(--c-text);
}

.btn--danger {
  background: var(--c-danger);
  border-color: var(--c-danger);
  color: #ffffff;
}

.btn--danger:hover:not(:disabled) {
  background: #b91c1c;
  border-color: #b91c1c;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.btn__spin {
  width: 12px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  opacity: 0.8;
  animation: btn-spin 700ms linear infinite;
}

@keyframes btn-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .btn__spin {
    animation: none;
  }
}
</style>
