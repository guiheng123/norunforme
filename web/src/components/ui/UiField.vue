<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
    hint?: string
    error?: string
    required?: boolean
    inline?: boolean
  }>(),
  { label: '', hint: '', error: '', required: false, inline: false },
)
</script>

<template>
  <label class="field" :class="{ 'field--inline': inline, 'is-error': Boolean(error) }">
    <span v-if="label" class="field__label">
      {{ label }}
      <em v-if="required" class="field__req">*</em>
    </span>
    <span class="field__control"><slot /></span>
    <span v-if="error" class="field__error">{{ error }}</span>
    <span v-else-if="hint" class="field__hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field--inline {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.field--inline .field__label {
  flex: 0 0 auto;
  margin: 0;
  min-width: 88px;
}

.field__label {
  font-size: 12px;
  color: var(--c-text-label);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.field__req {
  color: var(--c-danger);
  font-style: normal;
}

.field__control {
  display: block;
  min-width: 0;
}

.field__hint {
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-3);
}

.field__error {
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-danger);
}
</style>
