<template>
  <span class="app-logo" :class="`app-logo-${size}`">
    <svg class="app-logo-mark" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <rect width="96" height="96" rx="22" fill="#4338CA" />
      <rect x="21" y="25" width="54" height="13" rx="3.5" fill="#FFFFFF" />
      <rect x="26" y="42" width="44" height="31" rx="4.5" fill="#FFFFFF" />
      <path d="M42 50V66L57 58Z" fill="#4338CA" />
    </svg>
    <span v-if="wordmark" class="app-logo-word"><span class="app-logo-you">You</span><span class="app-logo-keep">Keep</span></span>
  </span>
</template>

<script setup lang="ts">
// The YouKeep mark (an archive box with a play button) and, optionally, the
// wordmark. One flat colour, no gradient, so it reads the same at any size.
withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg'; wordmark?: boolean }>(), { size: 'md', wordmark: true });
</script>

<style scoped>
.app-logo {
  display: inline-flex;
  align-items: center;
  gap: 0.45em;
  font-family: var(--font-title);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1;
  color: var(--text-primary);
}
.app-logo-sm { font-size: 18px; }
.app-logo-md { font-size: 22px; }
.app-logo-lg { font-size: 32px; }
.app-logo-mark {
  width: 1.35em;
  height: 1.35em;
  flex-shrink: 0;
}
.app-logo-you { font-weight: 500; }
.app-logo-keep { color: #A5B4FC; font-weight: 700; }
</style>
