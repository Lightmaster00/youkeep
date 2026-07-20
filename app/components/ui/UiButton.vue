<!-- app/components/ui/UiButton.vue -->
<template>
  <button
    class="btn"
    :class="[`btn-${variant}`, size !== 'md' ? `btn-${size}` : '']"
    :disabled="disabled || loading"
  >
    <span v-if="loading" class="spinner ui-button-spinner"></span>
    <slot v-else />
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'danger-outline';
  size?: 'md' | 'sm' | 'xs';
  loading?: boolean;
  disabled?: boolean;
}>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
});
</script>

<style scoped>
.ui-button-spinner {
  width: 14px;
  height: 14px;
  border-width: 2px;
}
</style>
