<template>
  <button
    v-if="pressed !== undefined"
    type="button"
    class="category-chip"
    :class="[`category-chip--${size}`, { 'is-active': pressed }]"
    :aria-pressed="pressed ? 'true' : 'false'"
    :title="pressed ? `Show every category` : `Show ${name} channels`"
    :data-testid="`category-chip-${name}`"
    @click.stop.prevent="emit('select', name)"
  >
    <span class="category-chip__label">{{ name }}</span>
    <span v-if="count !== undefined" class="category-chip__count">{{ count.toLocaleString('en-US') }}</span>
  </button>
  <NuxtLink
    v-else
    :to="{ path: '/channels', query: { category: name } }"
    class="category-chip"
    :class="`category-chip--${size}`"
    :title="`Show ${name} channels`"
    :data-testid="`category-chip-${name}`"
    @click.stop
  >
    <span class="category-chip__label">{{ name }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
// One channel category. A toggle (aria-pressed) when the page filters by
// category itself (`pressed` given: emits select), otherwise a link to the
// channels directory filtered by this category. Home, Subscriptions, the
// channel page and the directory all draw categories with it.
withDefaults(defineProps<{
  name: string;
  pressed?: boolean;
  count?: number;
  size?: 'sm' | 'md';
}>(), { pressed: undefined, count: undefined, size: 'sm' });

const emit = defineEmits<{ (e: 'select', name: string): void }>();
</script>

<style scoped>
.category-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
  border-radius: 999px;
  border: 1px solid transparent;
  background: rgba(139, 92, 246, 0.12);
  color: #c4b5fd;
  font-weight: 500;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--duration-fast, 0.15s) ease, border-color var(--duration-fast, 0.15s) ease;
}
.category-chip--sm {
  padding: 2px 8px;
  font-size: 11px;
  line-height: 16px;
}
.category-chip--md {
  height: 34px;
  padding: 0 14px;
  font-size: 13px;
  border-color: var(--glass-border, rgba(255, 255, 255, 0.08));
  background: var(--glass-bg, rgba(255, 255, 255, 0.04));
  color: var(--text-primary);
}
.category-chip:hover {
  background: rgba(139, 92, 246, 0.22);
}
.category-chip--md:hover {
  background: var(--bg-surface-hover, rgba(255, 255, 255, 0.08));
}
.category-chip:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
.category-chip.is-active {
  background: var(--text-primary);
  border-color: var(--text-primary);
  color: #0c0a12;
}
.category-chip__label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.category-chip__count {
  font-size: 0.9em;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
</style>
