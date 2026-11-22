<script setup lang="ts">
withDefaults(
  defineProps<{
    rows?: number
    height?: number
    lastShort?: boolean
  }>(),
  { rows: 4, height: 14, lastShort: true },
)
</script>

<template>
  <div class="skl" aria-hidden="true">
    <span
      v-for="i in rows"
      :key="i"
      class="skl__row"
      :style="{
        height: `${height}px`,
        width: lastShort && i === rows ? '58%' : '100%',
      }"
    ></span>
  </div>
</template>

<style scoped>
.skl {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skl__row {
  display: block;
  background: #eef2f7;
  border-radius: var(--r-sm);
}
</style>
