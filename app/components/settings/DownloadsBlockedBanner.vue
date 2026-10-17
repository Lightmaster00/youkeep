<template>
  <div v-if="reason" class="downloads-blocked-banner" role="alert" data-testid="downloads-blocked">
    Downloads are paused: {{ reasonText }}. Check that the downloads folder is mounted and writable.
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useDownloadsBlockedReason } from '~/composables/useActiveCounts';

// Filled by the active-counts poll and the downloader log (both report
// blockedReason when the downloads folder is missing or read-only).
const reason = useDownloadsBlockedReason();
// The server sentence ends with a period; the banner adds its own.
const reasonText = computed(() => (reason.value || '').trim().replace(/\.+$/, ''));
</script>

<style scoped>
.downloads-blocked-banner {
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.15);
  color: #fecaca;
  font-weight: 600;
  overflow-wrap: anywhere;
}
</style>
