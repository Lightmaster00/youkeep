<!-- app/components/ui/UiCard.vue -->
<template>
  <div class="ui-card" :class="{ 'ui-card--flat': flat }">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ flat?: boolean }>(), { flat: false });
</script>

<style scoped>
.ui-card {
  border-radius: var(--border-radius-lg);
  background: rgba(20, 20, 28, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
  transition: box-shadow var(--duration-base) var(--ease-standard);
  cursor: pointer;
}

.ui-card:hover {
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.35), 0 4px 16px -4px rgba(139, 92, 246, 0.15);
}

.ui-card--flat {
  cursor: default;
}
</style>
