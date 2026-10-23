<template>
  <BaseModal :show="!!manualCopy" :title="manualCopy?.title || t('common.copyLink')" @close="manualCopy = null">
    <p class="clipboard-fallback-hint">{{ t('common.copyUnavailable') }}</p>
    <input
      ref="inputEl"
      class="form-input clipboard-fallback-input"
      data-testid="clipboard-fallback-input"
      type="text"
      readonly
      :aria-label="t('common.textToCopy')"
      :value="manualCopy?.text || ''"
      @focus="selectAll"
    />
    <template #footer>
      <button type="button" class="btn btn-primary" @click="manualCopy = null">{{ t('common.done') }}</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
// The last resort of copyToClipboard() (app/utils/clipboard.ts).
import { ref, watch, nextTick } from 'vue';
import { manualCopy } from '~/utils/clipboard';

const { t } = useI18n();
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
