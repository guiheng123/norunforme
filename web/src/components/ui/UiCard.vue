<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    desc?: string
    flush?: boolean
    hoverable?: boolean
  }>(),
  { title: '', desc: '', flush: false, hoverable: true },
)
</script>

<template>
  <section class="card" :class="{ 'card--hover': hoverable }">
    <header v-if="title || desc || $slots.header || $slots.actions" class="card__head">
      <slot name="header">
        <div class="card__heading">
          <h3 v-if="title" class="card__title">{{ title }}</h3>
          <p v-if="desc" class="card__desc">{{ desc }}</p>
        </div>
      </slot>
      <div v-if="$slots.actions" class="card__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="card__body" :class="{ 'card__body--flush': flush }">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="card__foot">
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped>
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r);
  transition: box-shadow var(--t), border-color var(--t);
  min-width: 0;
}

.card--hover:hover {
  box-shadow: var(--shadow-hover);
}

.card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--c-border);
}

.card__heading {
  min-width: 0;
}

.card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
  letter-spacing: 0.01em;
}

.card__desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--c-text-3);
}

.card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.card__body {
  padding: 16px;
}

.card__body--flush {
  padding: 0;
}

.card__foot {
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
</style>
