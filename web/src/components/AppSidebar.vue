<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

interface NavItem {
  to: string
  label: string
  icon: string[]
}

const nav: NavItem[] = [
  {
    to: '/',
    label: '概览',
    icon: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  },
  {
    to: '/records',
    label: '跑步记录',
    icon: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  },
  {
    to: '/simulate',
    label: '模拟跑步',
    icon: ['M3 12h4l2.5-6 4 12 2.5-6h5'],
  },
  {
    to: '/device',
    label: '设备控制台',
    icon: ['M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M11 18h2'],
  },
  {
    to: '/settings',
    label: '设置',
    icon: [
      'M4 7h6',
      'M14 7h6',
      'M4 17h8',
      'M16 17h4',
      'M12 5a2 2 0 1 1 0 4a2 2 0 0 1 0-4z',
      'M12 15a2 2 0 1 1 0 4a2 2 0 0 1 0-4z',
    ],
  },
]

const route = useRoute()

function isActive(item: NavItem): boolean {
  if (item.to === '/') return route.path === '/'
  return route.path === item.to || route.path.startsWith(`${item.to}/`)
}

const activeLabel = computed(() => nav.find((item) => isActive(item))?.label ?? '')
</script>

<template>
  <aside class="side" :data-active="activeLabel">
    <div class="side__brand">
      <span class="side__mark" aria-hidden="true">乐</span>
      <span class="side__brand-text">
        <strong class="side__name">乐跑控制台</strong>
        <span class="side__sub">LEPAO CONSOLE</span>
      </span>
    </div>

    <nav class="side__nav" aria-label="主导航">
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="side__link"
        :class="{ 'is-active': isActive(item) }"
        :title="item.label"
      >
        <svg class="side__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path v-for="(d, index) in item.icon" :key="index" :d="d" />
        </svg>
        <span class="side__label">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div class="side__foot">
      <span class="side__ver">v1.0.0</span>
      <span class="side__meta">Web 控制台</span>
    </div>
  </aside>
</template>

<style scoped>
.side {
  position: fixed;
  inset: 0 auto 0 0;
  width: var(--sidebar-w);
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
}

.side__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--topbar-h);
  padding: 0 16px;
  border-bottom: 1px solid var(--c-border);
}

.side__mark {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: 6px;
  background: var(--c-primary);
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.side__brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.side__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
  white-space: nowrap;
}

.side__sub {
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--c-text-3);
  white-space: nowrap;
}

.side__nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px;
  overflow-y: auto;
}

.side__link {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border-radius: var(--r);
  color: var(--c-text-2);
  font-size: 13px;
  transition: background-color var(--t), color var(--t);
  white-space: nowrap;
}

.side__link:hover {
  background: #f8fafc;
  color: var(--c-text);
}

.side__link.is-active {
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-weight: 500;
  box-shadow: inset 2px 0 0 var(--c-primary);
}

.side__icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.side__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.side__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
  font-size: 11px;
  color: var(--c-text-3);
}

.side__ver {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1024px) {
  .side {
    width: var(--sidebar-w-collapsed);
  }

  .side__brand {
    justify-content: center;
    padding: 0;
  }

  .side__brand-text {
    display: none;
  }

  .side__nav {
    padding: 10px 8px;
    align-items: center;
  }

  .side__link {
    justify-content: center;
    width: 40px;
    padding: 0;
    box-shadow: none;
  }

  .side__link.is-active {
    box-shadow: none;
  }

  .side__label {
    display: none;
  }

  .side__foot {
    justify-content: center;
    padding: 12px 4px;
  }

  .side__meta {
    display: none;
  }
}
</style>
