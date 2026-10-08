<template>
  <div class="language-chips" role="group" aria-label="Filter by language">
    <button
      type="button"
      class="language-chip"
      :class="{ active: !modelValue }"
      :aria-pressed="!modelValue"
      @click="emit('update:modelValue', '')"
    >All</button>
    <button
      v-for="l in languages"
      :key="l.language"
      type="button"
      class="language-chip"
      :class="{ active: modelValue === l.language }"
      :aria-pressed="modelValue === l.language"
      @click="emit('update:modelValue', l.language)"
    >{{ l.language }} <span class="language-chip-count">{{ l.showCount }}</span></button>
  </div>
</template>

<script setup lang="ts">
// Language filter chips of the Podcasts Discover page. "All" (empty value)
// clears the filter.
defineProps<{ languages: Array<{ language: string; showCount: number }>; modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<style scoped>
.language-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.language-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: rgba(17, 17, 34, 0.4);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.language-chip:hover {
  border-color: rgba(139, 92, 246, 0.5);
}

.language-chip.active {
  border-color: var(--accent-primary);
  background: rgba(139, 92, 246, 0.25);
}

.language-chip-count {
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
