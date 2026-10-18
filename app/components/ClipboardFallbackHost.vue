<template>
  <BaseModal :show="!!manualCopy" :title="manualCopy?.title || 'Copy this link'" @close="manualCopy = null">
    <p class="clipboard-fallback-hint">Copying is not available here. The text is selected: press Ctrl+C (or Cmd+C) to copy it.</p>
    <input
      ref="inputEl"
      class="form-input clipboard-fallback-input"
      data-testid="clipboard-fallback-input"
      type="text"
      readonly
      aria-label="Text to copy"
      :value="manualCopy?.text || ''"
      @focus="selectAll"
    />
    <template #footer>
      <button type="button" class="btn btn-primary" @click="manualCopy = null">Done</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
// The last resort of copyToClipboard() (app/utils/clipboard.ts).
import { ref, watch, nextTick } from 'vue';
import { manualCopy } from '~/utils/clipboard';

const inputEl = ref<HTMLInputElement | null>(null);

function selectAll() {
  inputEl.value?.select();
}

watch(manualCopy, async (value) => {
  if (!value) return;
  await nextTick();
  // After BaseModal moved the focus to its card.
  setTimeout(() => {
    inputEl.value?.focus();
    selectAll();
  }, 0);
});
</script>

<style scoped>
.clipboard-fallback-hint {
  margin: 0 0 12px;
  color: var(--text-secondary);
  font-size: 14px;
}
.clipboard-fallback-input {
  width: 100%;
  min-width: 0;
  font-family: monospace;
}
</style>
