<template>
  <span v-if="user" class="episode-menu" @click.stop @keydown.stop>
    <button
      ref="triggerEl"
      type="button"
      class="episode-menu-btn"
      :class="{ open }"
      aria-label="More actions"
      title="More actions"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggleOpen"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panelEl"
        class="episode-menu-panel"
        role="menu"
        :style="panelStyle"
        @click.stop
      >
        <button type="button" class="episode-menu-item" role="menuitem" @click="togglePlayed">
          {{ played ? 'Mark as unplayed' : 'Mark as played' }}
        </button>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { usePodcastProgress } from '~/composables/usePodcastProgress';

// Row menu of an episode for the logged-in user: "Mark as played / unplayed".
// The panel is teleported to <body> so scrolling rows and cards cannot clip it.
const props = defineProps<{ episodeId: string }>();

const { user } = useAuth();
const progressStore = usePodcastProgress();
const played = computed(() => progressStore.get(props.episodeId)?.completed === true);

const open = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const PANEL_WIDTH = 200;
const GUTTER = 16;

function position() {
  const rect = triggerEl.value?.getBoundingClientRect();
  if (!rect) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(rect.right - PANEL_WIDTH, GUTTER), Math.max(GUTTER, vw - PANEL_WIDTH - GUTTER));
  const style: Record<string, string> = { left: `${left}px`, width: `${Math.min(PANEL_WIDTH, vw - 2 * GUTTER)}px` };
  if (rect.bottom + 60 > vh) style.bottom = `${vh - rect.top + 6}px`;
  else style.top = `${rect.bottom + 6}px`;
  panelStyle.value = style;
}

function onDocumentPointerDown(event: Event) {
  const target = event.target as Node | null;
  if (target && (panelEl.value?.contains(target) || triggerEl.value?.contains(target))) return;
  close();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
}

function removeListeners() {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown);
  window.removeEventListener('resize', close);
  window.removeEventListener('scroll', close, true);
}

function toggleOpen() {
  if (open.value) {
    close();
    return;
  }
  // Show the right label even if the row's progress lookup has not run yet.
  progressStore.ensure([props.episodeId]);
  open.value = true;
  position();
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeydown);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', close, true);
}

function close() {
  if (!open.value) return;
  open.value = false;
  removeListeners();
}

async function togglePlayed() {
  const next = !played.value;
  close();
  await progressStore.setPlayed(props.episodeId, next);
}

onBeforeUnmount(removeListeners);
</script>

<style scoped>
.episode-menu {
  display: inline-flex;
  flex-shrink: 0;
}

.episode-menu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.episode-menu-btn:hover,
.episode-menu-btn.open {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.episode-menu-btn:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.episode-menu-panel {
  position: fixed;
  z-index: 1000;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-md);
  background: rgba(22, 19, 30, 0.98);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.episode-menu-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.episode-menu-item:hover,
.episode-menu-item:focus-visible {
  background: rgba(255, 255, 255, 0.06);
}
</style>
