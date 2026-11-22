<script setup lang="ts">
import { computed } from 'vue'
import { fmtDelta } from '../../lib/format'

const props = withDefaults(
  defineProps<{
    label: string
    value: string | number
    unit?: string
    delta?: number | null
    deltaLabel?: string
    invert?: boolean
    loading?: boolean
  }>(),
  { unit: '', delta: null, deltaLabel: '较上周', invert: false, loading: false },
)

const deltaTone = computed(() => {
  if (props.delta === null || props.delta === undefined || props.delta === 0) return 'flat'
  const positive = props.delta > 0
  const good = props.invert ? !positive : positive
  return good ? 'up' : 'down'
})
</script>

<template>
  <div class="stat">
    <div class="stat__label">{{ label }}</div>
    <div v-if="loading" class="stat__value stat__value--loading">--</div>
    <div v-else class="stat__value">
      {{ value }}<span v-if="unit" class="stat__unit">{{ unit }}</span>
    </div>
    <div class="stat__meta">
      <template v-if="delta !== null && delta !== undefined">
        <span class="stat__delta" :class="`is-${deltaTone}`">{{ fmtDelta(delta) }}</span>
        <span class="stat__hint">{{ deltaLabel }}</span>
      </template>
      <slot v-else name="meta">
        <span class="stat__hint">{{ deltaLabel }}</span>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.stat {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  padding: 14px 16px 12px;
  min-width: 0;
  transition: box-shadow var(--t);
}

.stat:hover {
  box-shadow: var(--shadow-hover);
}

.stat__label {
  font-size: 12px;
  color: var(--c-text-label);
  letter-spacing: 0.02em;
}

.stat__value {
  margin-top: 6px;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.stat__value--loading {
  color: var(--c-text-3);
}

.stat__unit {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
  color: var(--c-text-3);
}

.stat__meta {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  min-height: 18px;
}

.stat__delta {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.stat__delta.is-up {
  color: var(--c-success);
}

.stat__delta.is-down {
  color: var(--c-danger);
}

.stat__delta.is-flat {
  color: var(--c-text-3);
}

.stat__hint {
  color: var(--c-text-3);
}
</style>
