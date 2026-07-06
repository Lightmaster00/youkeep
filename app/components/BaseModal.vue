<template>
  <div v-if="show" class="modal-overlay" @click="$emit('close')">
    <div class="modal-card glass-panel animate-pop" @click.stop>
      <div class="modal-header">
        <h3>{{ title }}</h3>
        <button class="close-modal-btn" @click="$emit('close')">&times;</button>
      </div>
      <div class="modal-body">
        <slot></slot>
      </div>
      <div v-if="$slots.footer" class="modal-footer">
        <slot name="footer"></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  show: boolean;
  title: string;
}>();

defineEmits<{
  (e: 'close'): void;
}>();
</script>
