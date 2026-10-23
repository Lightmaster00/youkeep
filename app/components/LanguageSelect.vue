<template>
  <select
    :key="resync"
    class="form-input"
    data-testid="ui-language-select"
    :value="current"
    :aria-label="t('language.interface')"
    @change="onChange"
  >
    <option v-for="code in codes" :key="code" :value="code">{{ LANGUAGE_NAMES[code] }}</option>
  </select>
</template>

<script setup lang="ts">
import { LANGUAGE_NAMES, isLanguageCode, type LanguageCode } from '#shared/languages';

const { t, locales } = useI18n();
const { current, change } = useUiLanguage();
const resync = ref(0);

// Only languages whose catalogue ships.
const codes = computed<LanguageCode[]>(() =>
  locales.value.map(l => (typeof l === 'string' ? l : l.code)).filter(isLanguageCode));

async function onChange(event: Event) {
  const code = (event.target as HTMLSelectElement).value;
  if (!isLanguageCode(code)) return;
  // The select is one-way bound: after a failed save, re-render it from `current`.
  if (!(await change(code))) resync.value++;
}
</script>
