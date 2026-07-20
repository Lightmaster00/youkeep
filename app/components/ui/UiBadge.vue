<!-- app/components/ui/UiBadge.vue -->
<template>
  <span class="badge" :class="`badge-${tone}`">
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'pending' | 'downloading' | 'completed' | 'failed' | 'neutral';
}>(), { tone: 'neutral' });
</script>
