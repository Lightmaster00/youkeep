<template>
  <span v-if="user" class="add-to-playlist">
    <button
      ref="triggerEl"
      type="button"
      class="add-to-playlist-btn"
      :class="{ open }"
      :aria-label="t('addToPlaylist.label')"
      :title="t('addToPlaylist.label')"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click.stop="toggleOpen"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="15" y2="6"></line><line x1="3" y1="12" x2="15" y2="12"></line><line x1="3" y1="18" x2="11" y2="18"></line><line x1="18" y1="13" x2="18" y2="21"></line><line x1="14" y1="17" x2="22" y2="17"></line></svg>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelEl"
        class="add-to-playlist-panel"
        role="menu"
        :aria-label="t('addToPlaylist.label')"
        :style="panelStyle"
        @click.stop
        @keydown.esc.stop="close"
      >
        <p class="atp-heading">{{ t('addToPlaylist.label') }}</p>

        <div v-if="loading" class="atp-status">{{ t('addToPlaylist.loading') }}</div>
        <div v-else-if="loadError" class="atp-status">
          {{ t('addToPlaylist.loadFailed') }}
          <button type="button" class="atp-link" @click="load">{{ t('common.retry') }}</button>
        </div>
        <template v-else>
          <p v-if="playlists.length === 0" class="atp-status">{{ t('addToPlaylist.none') }}</p>
          <ul v-else class="atp-list">
            <li v-for="p in playlists" :key="p.id">
              <button
                type="button"
                class="atp-item"
                role="menuitemcheckbox"
                :aria-checked="p.containsTrack"
                :disabled="pendingIds.has(p.id)"
                @click="togglePlaylist(p)"
              >
                <span class="atp-check" :class="{ on: p.containsTrack }" aria-hidden="true">
                  <svg v-if="p.containsTrack" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </span>
                <span class="atp-title">{{ p.title }}</span>
                <span class="atp-count">{{ p.trackCount }}</span>
              </button>
            </li>
          </ul>
        </template>

        <form class="atp-new" @submit.prevent="createAndAdd">
          <input
            v-model="newTitle"
            type="text"
            class="form-input atp-new-input"
            :placeholder="t('addToPlaylist.newPlaylist')"
            :aria-label="t('addToPlaylist.newName')"
            :maxlength="PLAYLIST_TITLE_MAX"
          />
          <button type="submit" class="btn btn-primary atp-new-btn" :disabled="creating || !newTitle.trim()">{{ t('common.create') }}</button>
        </form>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { apiErrorMessage } from '~/utils/apiError';
import { ref, nextTick, onBeforeUnmount } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { PLAYLIST_TITLE_MAX } from '#shared/musicPlaylists';

// "Add to playlist" popover for one track: the user's playlists with a check
// on those that already hold it (click toggles), plus an inline "New
// playlist" field that creates one and adds the track to it. The panel is
// teleported to <body> so the scrolling track rows and cards that host the
// button cannot clip it.
const props = defineProps<{ trackId: string }>();

interface PlaylistEntry { id: string; title: string; trackCount: number; containsTrack: boolean }

const { user } = useAuth();
const toast = useToast();
const { t } = useI18n();

const open = ref(false);
const loading = ref(false);
const loadError = ref(false);
const playlists = ref<PlaylistEntry[]>([]);
const pendingIds = ref(new Set<string>());
const newTitle = ref('');
const creating = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

const PANEL_WIDTH = 280;
const PANEL_MAX_HEIGHT = 360;
const GUTTER = 16;

function position() {
  const rect = triggerEl.value?.getBoundingClientRect();
  if (!rect) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const style: Record<string, string> = {};
  if (vw - 2 * GUTTER < PANEL_WIDTH + 40) {
    style.left = `${GUTTER}px`;
    style.right = `${GUTTER}px`;
  } else {
    const left = Math.min(Math.max(rect.right - PANEL_WIDTH, GUTTER), vw - PANEL_WIDTH - GUTTER);
    style.left = `${left}px`;
    style.width = `${PANEL_WIDTH}px`;
  }
  // Open upwards when there is not enough room below (e.g. in the player bar).
  if (rect.bottom + PANEL_MAX_HEIGHT + 8 > vh && rect.top > vh - rect.bottom) {
    style.bottom = `${vh - rect.top + 6}px`;
  } else {
    style.top = `${rect.bottom + 6}px`;
  }
  panelStyle.value = style;
}

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    const data = await $fetch<PlaylistEntry[]>('/api/music/user-playlists', { params: { containsTrack: props.trackId } });
    playlists.value = (data || []).map((p) => ({ ...p, containsTrack: !!p.containsTrack }));
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

function onDocumentPointerDown(event: Event) {
  const target = event.target as Node | null;
  if (target && (panelEl.value?.contains(target) || triggerEl.value?.contains(target))) return;
  close();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
}

function addListeners() {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeydown);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', position, true);
}

function removeListeners() {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown);
  window.removeEventListener('resize', close);
  window.removeEventListener('scroll', position, true);
}

async function toggleOpen() {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  position();
  addListeners();
  await load();
  await nextTick();
  position();
}

function close() {
  if (!open.value) return;
  open.value = false;
  newTitle.value = '';
  removeListeners();
}

async function togglePlaylist(p: PlaylistEntry) {
  const had = p.containsTrack;
  const pending = new Set(pendingIds.value);
  pending.add(p.id);
  pendingIds.value = pending;
  p.containsTrack = !had;
  try {
    const res = had
      ? await $fetch<{ trackCount: number }>(`/api/music/user-playlists/${encodeURIComponent(p.id)}/tracks/${encodeURIComponent(props.trackId)}`, { method: 'DELETE' })
      : await $fetch<{ trackCount: number }>(`/api/music/user-playlists/${encodeURIComponent(p.id)}/tracks`, { method: 'POST', body: { trackId: props.trackId } });
    if (typeof res?.trackCount === 'number') p.trackCount = res.trackCount;
    toast.success(had ? t('addToPlaylist.removed', { title: p.title }) : t('addToPlaylist.added', { title: p.title }));
  } catch (err: any) {
    p.containsTrack = had;
    toast.error(apiErrorMessage(err, t, had ? 'addToPlaylist.removeFailed' : 'addToPlaylist.addFailed'));
  } finally {
    const done = new Set(pendingIds.value);
    done.delete(p.id);
    pendingIds.value = done;
  }
}

async function createAndAdd() {
  const title = newTitle.value.trim();
  if (!title || creating.value) return;
  creating.value = true;
  try {
    const created = await $fetch<PlaylistEntry>('/api/music/user-playlists', { method: 'POST', body: { title } });
    const entry: PlaylistEntry = { id: created.id, title: created.title, trackCount: 0, containsTrack: false };
    playlists.value = [entry, ...playlists.value];
    newTitle.value = '';
    await togglePlaylist(playlists.value[0]!);
  } catch (err: any) {
    toast.error(apiErrorMessage(err, t, 'addToPlaylist.createFailed'));
  } finally {
    creating.value = false;
  }
}

onBeforeUnmount(removeListeners);
</script>

<style scoped>
.add-to-playlist {
  display: inline-flex;
  flex-shrink: 0;
}

.add-to-playlist-btn {
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
  transition: color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
}

.add-to-playlist-btn:hover,
.add-to-playlist-btn.open {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.add-to-playlist-btn:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.add-to-playlist-panel {
  position: fixed;
  z-index: 1000;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: rgba(22, 19, 30, 0.98);
  border: 1px solid var(--glass-border);
  border-radius: var(--border-radius-md);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
  font-size: 14px;
  cursor: default;
}

.atp-heading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.atp-status {
  margin: 0;
  padding: var(--space-2) 0;
  color: var(--text-secondary);
}

.atp-link {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent-primary-hover);
  cursor: pointer;
  text-decoration: underline;
}

.atp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}

.atp-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 8px 6px;
  border: none;
  border-radius: var(--border-radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.atp-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.atp-item:disabled {
  opacity: 0.6;
  cursor: progress;
}

.atp-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border: 1.5px solid var(--text-muted);
  border-radius: 4px;
}

.atp-check.on {
  border-color: var(--accent-primary);
  background: var(--accent-primary);
  color: #fff;
}

.atp-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atp-count {
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.atp-new {
  display: flex;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--glass-border);
}

.atp-new-input {
  flex: 1;
  min-width: 0;
}

.atp-new-btn {
  flex-shrink: 0;
}
</style>
