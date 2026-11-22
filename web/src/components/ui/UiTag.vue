<script setup lang="ts">
import type { Tone } from '../../lib/format'

withDefaults(
  defineProps<{
    tone?: Tone
    outline?: boolean
  }>(),
  { tone: 'neutral', outline: false },
)
</script>

<template>
  <span class="tag" :class="[`tag--${tone}`, { 'tag--outline': outline }]">
    <slot />
  </span>
</template>

<style scoped>
.tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.tag--neutral {
  background: #f1f5f9;
  color: var(--c-text-2);
}

.tag--primary {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.tag--success {
  background: var(--c-success-soft);
  color: var(--c-success);
}

.tag--warning {
  background: var(--c-warning-soft);
  color: var(--c-warning);
}

.tag--danger {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.tag--outline {
  background: transparent;
  border-color: currentColor;
  opacity: 0.9;
}
</style>
