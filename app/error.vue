<template>
  <div class="error-page">
    <NuxtLink to="/" class="error-logo" :aria-label="t('error.home')">
      <AppLogo size="lg" />
    </NuxtLink>
    <main class="error-card" role="main">
      <p class="error-code" aria-hidden="true">{{ statusCode }}</p>
      <h1 class="error-title">{{ title }}</h1>
      <p class="error-text">{{ description }}</p>
      <div class="error-actions">
        <button type="button" class="btn btn-primary" @click="goHome">{{ t('error.backHome') }}</button>
        <button v-if="statusCode !== 404" type="button" class="btn btn-secondary" @click="retry">{{ t('error.tryAgain') }}</button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
// Branded error page (unknown address, server error) instead of Nuxt's
// default one: the app's look, one message, and a way back.
import { computed } from 'vue';

const { t } = useI18n();

const props = defineProps<{ error: { statusCode?: number; statusMessage?: string; message?: string } | null }>();

const statusCode = computed(() => Number(props.error?.statusCode) || 500);
const title = computed(() => (statusCode.value === 404 ? t('error.notFoundTitle') : t('error.genericTitle')));
const description = computed(() => (statusCode.value === 404
  ? t('error.notFoundText')
  : t('error.genericText')));

// The error page replaces app.vue (and its title template): full title here.
useHead({
  titleTemplate: null,
  title: computed(() => `${statusCode.value === 404 ? t('error.notFoundTitle') : t('error.errorShort')} — YouKeep`),
});

function goHome() {
  clearError({ redirect: '/' });
}

function retry() {
  clearError();
  if (import.meta.client) window.location.reload();
}
</script>

<style scoped>
.error-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  padding: 24px 16px;
  background: var(--bg-base);
  color: var(--text-primary);
}
.error-logo {
  display: inline-flex;
}
.error-card {
  max-width: 440px;
  width: 100%;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.error-code {
  margin: 0;
  font-size: 64px;
  font-weight: 800;
  line-height: 1;
  color: var(--accent-primary);
}
.error-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}
.error-text {
  margin: 0;
  color: var(--text-secondary);
}
.error-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 12px;
}
</style>
