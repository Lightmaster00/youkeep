<template>
  <header class="mch">
    <div class="mch-art" aria-hidden="true">
      <slot name="art">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
      </slot>
    </div>
    <div class="mch-info">
      <p class="mch-kicker">{{ kicker }}</p>
      <slot name="title">
        <h1 class="page-title mch-title">{{ title }}</h1>
      </slot>
      <p v-if="subtitle" class="mch-subtitle">{{ subtitle }}</p>
      <div class="mch-buttons">
        <button type="button" class="btn btn-primary" :disabled="!canPlay" @click="emit('play')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          Play
        </button>
        <button type="button" class="btn btn-secondary" :disabled="!canPlay" @click="emit('shuffle')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
          Shuffle
        </button>
        <slot name="buttons" />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
// Header of a track collection page (Liked songs, a playlist): art, title,
// count line and the Play / Shuffle buttons, plus slots for page extras.
defineProps<{ kicker: string; title?: string; subtitle?: string; canPlay: boolean }>();
const emit = defineEmits<{ play: []; shuffle: [] }>();
</script>

<style scoped>
.mch {
  display: flex;
  align-items: flex-end;
  gap: var(--space-5);
  margin-bottom: var(--space-5);
}

.mch-art {
  width: 160px;
  height: 160px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--border-radius-md);
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: rgba(255, 255, 255, 0.92);
  box-shadow: var(--shadow-md);
}

.mch-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  flex: 1;
}

.mch-kicker {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.mch-title {
  margin: 0;
  overflow-wrap: anywhere;
}

.mch-subtitle {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.mch-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.mch-buttons .btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 640px) {
  .mch {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
  }

  .mch-art {
    width: 120px;
    height: 120px;
  }
}
</style>
