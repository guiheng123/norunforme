<script setup lang="ts">
import type { DiagnosticItem } from '../api/types'

withDefaults(defineProps<{ items: DiagnosticItem[]; compact?: boolean }>(), { compact: false })
</script>

<template>
  <ul class="diag" :class="{ 'diag--compact': compact }">
    <li v-for="item in items" :key="item.key" class="diag__row" :class="`is-${item.level}`">
      <span class="diag__flag" aria-hidden="true">
        <svg v-if="item.level === 'pass'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
        <svg v-else-if="item.level === 'warn'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M12 8v5" />
          <path d="M12 16.4v.2" />
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </span>
      <span class="diag__label">{{ item.label }}</span>
      <span class="diag__value">{{ item.value }}</span>
      <span class="diag__detail">{{ item.detail }}</span>
    </li>
    <li v-if="!items.length" class="diag__empty">暂无诊断数据</li>
  </ul>
</template>

<style scoped>
.diag {
  display: flex;
  flex-direction: column;
}

.diag__row {
  display: grid;
  grid-template-columns: 16px 84px minmax(64px, auto) 1fr;
  gap: 8px;
  align-items: baseline;
  padding: 7px 0;
  border-bottom: 1px solid #f1f5f9;
  font-size: 12px;
}

.diag__row:last-child {
  border-bottom: none;
}

.diag__flag {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  align-self: center;
}

.is-pass .diag__flag {
  background: var(--c-success);
}

.is-warn .diag__flag {
  background: var(--c-warning);
}

.is-fail .diag__flag {
  background: var(--c-danger);
}

.diag__label {
  color: var(--c-text);
  font-weight: 500;
  white-space: nowrap;
}

.diag__value {
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.diag__detail {
  color: var(--c-text-3);
  line-height: 1.5;
}

.is-warn .diag__value {
  color: var(--c-warning);
}

.is-fail .diag__value {
  color: var(--c-danger);
}

.diag__empty {
  padding: 10px 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.diag--compact .diag__row {
  grid-template-columns: 16px 78px minmax(56px, auto) 1fr;
  padding: 6px 0;
}

@media (max-width: 1280px) {
  .diag__row {
    grid-template-columns: 16px 84px 1fr;
  }

  .diag__detail {
    grid-column: 2 / -1;
  }
}
</style>
