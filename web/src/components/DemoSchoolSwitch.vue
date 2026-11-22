<script setup lang="ts">
import { computed } from 'vue'
import { DEMO_SCHOOLS, demoSchoolByKey } from '../lib/demo'
import { switchDemoSchool, store } from '../store'

const emit = defineEmits<{
  (e: 'change', key: string): void
}>()

const currentKey = computed(() => store.demoSchool)
const current = computed(() => demoSchoolByKey(currentKey.value))

function pick(key: string): void {
  if (key === currentKey.value) return
  switchDemoSchool(key)
  emit('change', key)
}
</script>

<template>
  <div class="demo-switch">
    <div class="demo-switch__lead">
      <span class="demo-switch__badge">演示</span>
      <span class="demo-switch__text">
        当前学校 <strong>{{ current.name }}</strong>
        <em>· {{ current.zoneName }} · {{ current.checkpoints.length }} 个打卡点</em>
      </span>
    </div>
    <div class="demo-switch__chips">
      <button
        v-for="school in DEMO_SCHOOLS"
        :key="school.key"
        type="button"
        class="demo-switch__chip"
        :class="{ 'is-active': school.key === currentKey }"
        :title="`地图切换到 ${school.name}`"
        @click="pick(school.key)"
      >
        {{ school.name }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.demo-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--c-primary-border);
  border-radius: var(--r);
  background: var(--c-primary-soft);
}

.demo-switch__lead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.demo-switch__badge {
  flex: 0 0 auto;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--c-primary);
  color: #fff;
  font-size: 10px;
  line-height: 18px;
  font-weight: 600;
}

.demo-switch__text {
  min-width: 0;
  font-size: 12px;
  color: var(--c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.demo-switch__text strong {
  color: var(--c-text);
  font-weight: 600;
}

.demo-switch__text em {
  font-style: normal;
  color: var(--c-text-3);
  font-size: 11px;
}

.demo-switch__chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.demo-switch__chip {
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-surface);
  font-size: 11px;
  color: var(--c-text-2);
  transition: border-color var(--t), color var(--t), background var(--t);
}

.demo-switch__chip:hover {
  border-color: var(--c-primary-border);
  color: var(--c-text);
}

.demo-switch__chip.is-active {
  border-color: var(--c-primary);
  background: var(--c-primary);
  color: #fff;
}
</style>