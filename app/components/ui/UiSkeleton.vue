<!-- app/components/ui/UiSkeleton.vue -->
<template>
  <div
    class="ui-skeleton"
    :style="{ width, height, borderRadius: `var(--border-radius-${rounded})` }"
  ></div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  width?: string;
  height?: string;
  rounded?: 'sm' | 'md' | 'lg';
}>(), {
  width: '100%',
  height: '16px',
  rounded: 'md',
});
</script>

<style scoped>
.ui-skeleton {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 25%,
    rgba(255, 255, 255, 0.09) 37%,
    rgba(255, 255, 255, 0.04) 63%
  );
  background-size: 400% 100%;
  animation: ui-skeleton-pulse 1.6s ease-in-out infinite;
}

@keyframes ui-skeleton-pulse {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
</style>
