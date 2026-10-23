<template>
  <div data-testid="content-language">
    <label class="form-label" for="content_language">{{ t('language.content') }}</label>
    <select
      id="content_language"
      :key="resync"
      class="form-input"
      data-testid="content-language-select"
      :value="current"
      :disabled="available === false"
      :aria-describedby="available === false ? 'content_language_note' : 'content_language_help'"
      @change="onChange"
    >
      <option value="original">{{ t('language.contentOriginal') }}</option>
      <option v-for="code in SUPPORTED_LANGUAGES" :key="code" :value="code">{{ LANGUAGE_NAMES[code] }}</option>
    </select>
    <p id="content_language_help" class="section-desc mt-2 mb-0" data-testid="content-language-help">{{ t('language.contentHelp') }}</p>
    <p v-if="available === false" id="content_language_note" class="section-desc mt-2 mb-0" data-testid="content-language-unavailable">{{ t('language.contentUnavailable') }}</p>
  </div>
</template>

<script setup lang="ts">
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '#shared/languages';

const { t } = useI18n();
const { current, available, load, change } = useContentLanguage();
const resync = ref(0);

onMounted(load);

async function onChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (!isContentLanguage(value)) return;
  // The select is one-way bound: after a failed save, re-render it from `current`.
  if (!(await change(value))) resync.value++;
}
</script>
