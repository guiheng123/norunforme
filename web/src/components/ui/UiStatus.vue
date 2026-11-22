<script setup lang="ts">
import type { Tone } from '../../lib/format'

withDefaults(
  defineProps<{
    tone?: Tone
    label: string
    dot?: boolean
  }>(),
  { tone: 'neutral', dot: true },
)
</script>

<template>
  <span class="pill" :class="`pill--${tone}`">
    <span v-if="dot" class="pill__dot" aria-hidden="true"></span>
    <span class="pill__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--c-border);
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  background: var(--c-surface);
  color: var(--c-text-2);
}

.pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-text-3);
  flex: 0 0 auto;
}

.pill__label {
  font-variant-numeric: tabular-nums;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill--success {
  border-color: var(--c-success-border);
  background: var(--c-success-soft);
  color: #15803d;
}

.pill--success .pill__dot {
  background: var(--c-success);
}

.pill--warning {
  border-color: var(--c-warning-border);
  background: var(--c-warning-soft);
  color: #b45309;
}

.pill--warning .pill__dot {
  background: var(--c-warning);
}

.pill--danger {
  border-color: var(--c-danger-border);
  background: var(--c-danger-soft);
  color: #b91c1c;
}

.pill--danger .pill__dot {
  background: var(--c-danger);
}

.pill--primary {
  border-color: var(--c-primary-border);
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.pill--primary .pill__dot {
  background: var(--c-primary);
}
</style>
