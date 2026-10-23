<template>
  <div
    v-if="loading"
    class="category-bar"
    aria-hidden="true"
    data-testid="category-bar-loading"
  >
    <UiSkeleton v-for="n in 6" :key="n" width="92px" height="34px" rounded="lg" class="category-bar__skeleton" />
  </div>
  <div
    v-else
    ref="bar"
    class="category-bar"
    role="toolbar"
    aria-label="Filter by category"
    data-testid="category-bar"
    @keydown="onKeydown"
  >
    <button
      type="button"
      class="category-chip-all"
      :class="{ 'is-active': !modelValue }"
      :aria-pressed="!modelValue ? 'true' : 'false'"
      data-testid="category-chip-all"
      @click="emit('update:modelValue', '')"
    >All</button>
    <CategoryChip
      v-for="cat in categories"
      :key="cat.name"
      :name="cat.name"
      :count="cat.count"
      :pressed="isActive(cat.name)"
      size="md"
      @select="toggle"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import CategoryChip from '~/components/channels/CategoryChip.vue';

// The category filter of the channels directory: "All", then every category
// with its channel count. Toggle buttons (aria-pressed); the arrow keys and
// Home/End move between them, Enter/Space or a click picks. Picking the
// active category again goes back to "All".
const props = defineProps<{
  categories: { name: string; count: number }[];
  modelValue: string;
  loading?: boolean;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', name: string): void }>();

const bar = ref<HTMLElement | null>(null);

const isActive = (name: string) => !!props.modelValue && props.modelValue.toLowerCase() === name.toLowerCase();

function toggle(name: string) {
  emit('update:modelValue', isActive(name) ? '' : name);
}

function onKeydown(event: KeyboardEvent) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key) || !bar.value) return;
  const chips = [...bar.value.querySelectorAll<HTMLButtonElement>('button')];
  const current = chips.indexOf(document.activeElement as HTMLButtonElement);
  let next = current;
  if (event.key === 'ArrowLeft') next = current <= 0 ? chips.length - 1 : current - 1;
  else if (event.key === 'ArrowRight') next = current >= chips.length - 1 ? 0 : current + 1;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = chips.length - 1;
  event.preventDefault();
  chips[next]?.focus();
  chips[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
</script>

<style scoped>
.category-bar {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 2px 8px;
  margin: 0 -2px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  min-width: 0;
}
.category-bar::-webkit-scrollbar { display: none; }
.category-bar > * { flex: 0 0 auto; }
.category-bar__skeleton { flex: 0 0 auto; }

.category-chip-all {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.08));
  background: var(--glass-bg, rgba(255, 255, 255, 0.04));
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.category-chip-all:hover { background: var(--bg-surface-hover, rgba(255, 255, 255, 0.08)); }
.category-chip-all:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
.category-chip-all.is-active {
  background: var(--text-primary);
  border-color: var(--text-primary);
  color: #0c0a12;
}
</style>
