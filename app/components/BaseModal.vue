<template>
  <div v-if="show" class="modal-overlay" @click="$emit('close')">
    <div
      ref="modalCardEl"
      class="modal-card glass-panel animate-pop"
      role="dialog"
      :aria-modal="show"
      tabindex="-1"
      @click.stop
    >
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
import { ref, watch, nextTick, onUnmounted } from 'vue';

const props = defineProps<{
  show: boolean;
  title: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const modalCardEl = ref<HTMLElement | null>(null);
let previouslyFocusedEl: HTMLElement | null = null;

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close');
  }
}

watch(() => props.show, (isShown) => {
  if (isShown) {
    previouslyFocusedEl = document.activeElement as HTMLElement | null;
    document.addEventListener('keydown', onKeydown);
    nextTick(() => {
      modalCardEl.value?.focus();
    });
  } else {
    document.removeEventListener('keydown', onKeydown);
    if (previouslyFocusedEl && document.contains(previouslyFocusedEl)) {
      previouslyFocusedEl.focus();
    }
    previouslyFocusedEl = null;
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>
