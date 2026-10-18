<template>
  <div class="error-page">
    <NuxtLink to="/" class="error-logo" aria-label="YouKeep home">
      <span class="error-logo-you">You</span><span class="error-logo-keep">Keep</span>
    </NuxtLink>
    <main class="error-card" role="main">
      <p class="error-code" aria-hidden="true">{{ statusCode }}</p>
      <h1 class="error-title">{{ title }}</h1>
      <p class="error-text">{{ description }}</p>
      <div class="error-actions">
        <button type="button" class="btn btn-primary" @click="goHome">Back to Home</button>
        <button v-if="statusCode !== 404" type="button" class="btn btn-secondary" @click="retry">Try again</button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
// Branded error page (unknown address, server error) instead of Nuxt's
// default one: the app's look, one message, and a way back.
import { computed } from 'vue';

const props = defineProps<{ error: { statusCode?: number; statusMessage?: string; message?: string } | null }>();

const statusCode = computed(() => Number(props.error?.statusCode) || 500);
const title = computed(() => (statusCode.value === 404 ? 'Page not found' : 'Something went wrong'));
const description = computed(() => (statusCode.value === 404
  ? 'This page does not exist or has moved.'
  : 'YouKeep could not show this page. Try again in a moment.'));

// The error page replaces app.vue (and its title template): full title here.
useHead({
  titleTemplate: null,
  title: computed(() => `${statusCode.value === 404 ? 'Page not found' : 'Error'} — YouKeep`),
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
  font-family: var(--font-title);
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.error-logo-you {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.error-logo-keep {
  margin-left: 4px;
  padding: 1px 7px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-weight: 600;
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
