<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import OfflineNote from './components/OfflineNote.vue'
import BrandMark from './components/BrandMark.vue'
import NoticeModal from './components/NoticeModal.vue'
import UiToast from './components/ui/UiToast.vue'
import { netState } from './lib/net'

const route = useRoute()
const bare = computed(() => route.meta.bare === true)
</script>

<template>
  <div class="shell">
    <AppSidebar v-if="!bare" />
    <div class="shell__main" :class="{ 'shell__main--bare': bare }">
      <AppTopbar v-if="!bare" />
      <main class="shell__content" :class="{ 'shell__content--bare': bare }">
        <OfflineNote v-if="netState.offline && !bare" />
        <RouterView v-slot="{ Component }">
          <component :is="Component" />
        </RouterView>
      </main>
    </div>
    <UiToast />
    <BrandMark />
    <NoticeModal />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100%;
  background: var(--c-bg);
}

.shell__main {
  flex: 1;
  min-width: 0;
  margin-left: var(--sidebar-w);
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.shell__main--bare {
  margin-left: 0;
}

.shell__content {
  width: 100%;
  max-width: var(--content-max);
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.shell__content--bare {
  max-width: none;
  padding: 0;
  flex: 1;
}

@media (max-width: 1024px) {
  .shell__main {
    margin-left: var(--sidebar-w-collapsed);
  }

  .shell__content {
    padding: 16px;
  }
}
</style>
