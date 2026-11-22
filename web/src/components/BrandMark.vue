<script setup lang="ts">
import { SIG_REPO, SIG_OWNER, MARK_SHORT, encodeMarks } from '../lib/attest'

const marks = encodeMarks(MARK_SHORT)
const href = SIG_REPO
const label = `${SIG_OWNER}/norunforme`
</script>

<template>
  <a class="brand" :href="href" target="_blank" rel="noopener noreferrer" :title="href">
    <span>{{ label }}</span>
    <span class="brand__mk" aria-hidden="true">{{ marks }}</span>
  </a>
</template>

<style scoped>
.brand {
  position: fixed;
  right: 10px;
  bottom: 8px;
  z-index: 1;
  display: inline-flex;
  align-items: baseline;
  padding: 2px 6px;
  border-radius: var(--r-sm);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.4;
  letter-spacing: 0.02em;
  color: var(--c-text-3);
  text-decoration: none;
  opacity: 0.34;
  user-select: none;
  transition: opacity var(--t), color var(--t);
}

.brand:hover {
  opacity: 0.9;
  color: var(--c-text-2);
}

.brand__mk {
  font-size: 0;
  line-height: 0;
  letter-spacing: 0;
}

@media (max-width: 768px) {
  .brand {
    right: 6px;
    bottom: 4px;
    font-size: 9px;
  }
}
</style>