<template>
  <span class="app-logo" :class="`app-logo-${size}`">
    <svg class="app-logo-mark" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#22D3EE" />
          <stop offset=".55" stop-color="#3B5BFF" />
          <stop offset="1" stop-color="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="58" :fill="`url(#${gid})`" />
      <path d="M128 42 L198 68 V128 C198 168 168 196 128 214 C88 196 58 168 58 128 V68 Z" fill="#FFFFFF" />
      <path d="M111 100 V156 L158 128 Z" fill="#3B5BFF" stroke="#3B5BFF" stroke-width="10" stroke-linejoin="round" />
    </svg>
    <span v-if="wordmark" class="app-logo-word"><span class="app-logo-you">You</span><span class="app-logo-keep">Keep</span></span>
  </span>
</template>

<script setup lang="ts">
// The YouKeep mark (a shield with a play button) and, optionally, the wordmark.
// Each instance gets its own gradient id so several logos on one page don't clash.
import { useId } from 'vue';
const gid = `yk-grad-${useId()}`;
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
.app-logo-keep { color: #7DD3FC; font-weight: 700; }
</style>
