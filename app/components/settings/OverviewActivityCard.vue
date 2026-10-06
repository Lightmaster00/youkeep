<template>
  <div class="activity-card glass-panel" data-testid="overview-activity">
    <div class="activity-head">
      <h3>Activity</h3>
      <NuxtLink to="/settings?tab=downloads" class="btn btn-secondary-dark btn-sm" data-testid="activity-open-downloads">Open Downloads</NuxtLink>
    </div>
    <p v-if="!counts" class="section-desc">Loading...</p>
    <template v-else>
      <p class="activity-summary" data-testid="activity-summary">{{ summary }}</p>
      <ul class="activity-list">
        <li v-for="row in rows" :key="row.key" :data-testid="`activity-${row.key}`">
          <span class="activity-label">{{ row.label }}</span>
          <span>{{ row.downloading }} downloading · {{ row.pending }} queued</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useActiveCounts } from '~/composables/useActiveCounts';

const { counts, downloadingTotal, queuedTotal, fetchActiveCounts } = useActiveCounts();

const rows = computed(() => {
  const c = counts.value;
  if (!c) return [];
  return [
    { key: 'video', label: 'Videos', ...c.video },
    { key: 'music', label: 'Music', ...c.music },
    { key: 'podcasts', label: 'Podcasts', ...c.podcasts },
  ];
});

const summary = computed(() =>
  downloadingTotal.value === 0 && queuedTotal.value === 0
    ? 'Nothing is downloading'
    : `${downloadingTotal.value} downloading now, ${queuedTotal.value} queued`,
);

onMounted(fetchActiveCounts);
</script>

<style scoped>
.activity-card { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
.activity-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.activity-head h3 { margin: 0; font-size: 18px; font-weight: 700; }
.activity-summary { margin: 0; font-size: 15px; font-weight: 600; }
.activity-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-secondary); }
.activity-list li { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.activity-label { font-weight: 600; color: var(--text-primary, inherit); }
</style>
