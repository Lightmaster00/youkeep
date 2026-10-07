<template>
  <div class="playlist-detail-page">
    <NuxtLink to="/music/playlists" class="btn btn-secondary pd-back">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      Playlists
    </NuxtLink>

    <div v-if="pending" class="pd-status">Loading...</div>
    <EmptyState
      v-else-if="notFound"
      icon="folder"
      title="Playlist not found"
      description="It may have been deleted."
    />
    <div v-else-if="loadError" class="pd-status">
      Failed to load the playlist.
      <button class="btn btn-secondary" @click="load">Retry</button>
    </div>

    <template v-else-if="playlist">
      <MusicCollectionHeader
        kicker="Playlist"
        :subtitle="countLabel"
        :can-play="tracks.length > 0"
        @play="playAll(tracks)"
        @shuffle="shuffleAll(tracks)"
      >
        <template #art>
          <PlaylistCoverMosaic :urls="coverUrls" />
        </template>
        <template #title>
          <form v-if="editing" class="pd-edit" @submit.prevent="saveEdit">
            <input
              ref="titleInput"
              v-model="editTitle"
              type="text"
              class="form-input pd-edit-title"
              aria-label="Playlist name"
              :maxlength="PLAYLIST_TITLE_MAX"
            />
            <textarea
              v-model="editDescription"
              class="form-input pd-edit-description"
              rows="2"
              placeholder="Description (optional)"
              aria-label="Playlist description"
              :maxlength="PLAYLIST_DESCRIPTION_MAX"
            ></textarea>
            <div class="pd-edit-actions">
              <button type="button" class="btn btn-secondary" @click="editing = false">Cancel</button>
              <button type="submit" class="btn btn-primary" :disabled="saving || !editTitle.trim()">Save</button>
            </div>
          </form>
          <template v-else>
            <h1 class="page-title pd-title">{{ playlist.title }}</h1>
            <p v-if="playlist.description" class="pd-description">{{ playlist.description }}</p>
          </template>
        </template>
        <template #buttons>
          <button v-if="!editing" type="button" class="btn btn-secondary" @click="startEdit">Edit</button>
          <button type="button" class="btn btn-danger-outline" @click="confirmingDelete = true">Delete playlist</button>
        </template>
      </MusicCollectionHeader>

      <EmptyState
        v-if="tracks.length === 0"
        icon="music"
        title="This playlist is empty"
        description="Add songs from the Music library with the playlist button on any track."
      />
      <MusicTrackList
        v-else
        :tracks="tracks"
        :active-id="currentTrack?.id"
        @play="(track) => playFrom(track, tracks)"
      >
        <template #actions="{ track, index }">
          <button
            type="button"
            class="pd-row-btn"
            :aria-label="`Move ${track.title} up`"
            title="Move up"
            :disabled="reordering || index === 0"
            @click="move(index, -1)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>
          </button>
          <button
            type="button"
            class="pd-row-btn"
            :aria-label="`Move ${track.title} down`"
            title="Move down"
            :disabled="reordering || index === tracks.length - 1"
            @click="move(index, 1)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <button
            type="button"
            class="pd-row-btn pd-remove"
            :aria-label="`Remove ${track.title} from this playlist`"
            title="Remove from this playlist"
            :disabled="reordering"
            @click="removeTrack(track)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </template>
      </MusicTrackList>
    </template>

    <BaseModal :show="confirmingDelete" title="Delete playlist?" @close="confirmingDelete = false">
      <p class="pd-confirm-text">
        "{{ playlist?.title }}" will be deleted. The songs stay in your library.
      </p>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="confirmingDelete = false">Cancel</button>
        <button type="button" class="btn btn-danger" :disabled="deleting" @click="deletePlaylist">Delete</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useToast } from '~/composables/useToast';
import { usePlayTrackList } from '~/composables/usePlayTrackList';
import { PLAYLIST_TITLE_MAX, PLAYLIST_DESCRIPTION_MAX, moveItem } from '#shared/musicPlaylists';

interface PlaylistInfo { id: string; title: string; description: string | null; trackCount: number; coverUrls: string[] }

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { playAll, shuffleAll, playFrom, currentTrack } = usePlayTrackList();

const id = computed(() => String(route.params.id || ''));
const playlist = ref<PlaylistInfo | null>(null);
const tracks = ref<any[]>([]);
const pending = ref(true);
const notFound = ref(false);
const loadError = ref(false);

const editing = ref(false);
const editTitle = ref('');
const editDescription = ref('');
const saving = ref(false);
const titleInput = ref<HTMLInputElement | null>(null);

const reordering = ref(false);
const confirmingDelete = ref(false);
const deleting = ref(false);

const countLabel = computed(() => (tracks.value.length === 1 ? '1 song' : `${tracks.value.length} songs`));
const coverUrls = computed(() =>
  tracks.value.slice(0, 4).map((t) => t.local_thumbnail_path || t.album_cover_url).filter(Boolean)
);

const base = () => `/api/music/user-playlists/${encodeURIComponent(id.value)}`;

async function load() {
  pending.value = true;
  notFound.value = false;
  loadError.value = false;
  try {
    const data = await $fetch<{ playlist: PlaylistInfo; tracks: any[] }>(base());
    playlist.value = data.playlist;
    tracks.value = data.tracks || [];
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.response?.status === 404) notFound.value = true;
    else loadError.value = true;
  } finally {
    pending.value = false;
  }
}

async function startEdit() {
  if (!playlist.value) return;
  editTitle.value = playlist.value.title;
  editDescription.value = playlist.value.description || '';
  editing.value = true;
  await nextTick();
  titleInput.value?.focus();
}

async function saveEdit() {
  const title = editTitle.value.trim();
  if (!title || saving.value || !playlist.value) return;
  saving.value = true;
  try {
    const updated = await $fetch<PlaylistInfo>(base(), {
      method: 'PUT',
      body: { title, description: editDescription.value.trim() || null },
    });
    playlist.value = { ...playlist.value, title: updated.title, description: updated.description };
    editing.value = false;
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the playlist.');
  } finally {
    saving.value = false;
  }
}

// Optimistic: the row moves at once and moves back if the server refuses.
async function move(index: number, delta: number) {
  if (reordering.value) return;
  const previous = tracks.value;
  const next = moveItem(previous, index, delta);
  if (next.every((t, i) => t === previous[i])) return;
  tracks.value = next;
  reordering.value = true;
  try {
    await $fetch(`${base()}/order`, { method: 'PUT', body: { trackIds: next.map((t) => t.id) } });
  } catch (err: any) {
    tracks.value = previous;
    toast.error(err?.data?.statusMessage || 'Could not reorder the playlist.');
  } finally {
    reordering.value = false;
  }
}

async function removeTrack(track: any) {
  if (reordering.value) return;
  const previous = tracks.value;
  tracks.value = previous.filter((t) => t.id !== track.id);
  reordering.value = true;
  try {
    await $fetch(`${base()}/tracks/${encodeURIComponent(track.id)}`, { method: 'DELETE' });
  } catch (err: any) {
    tracks.value = previous;
    toast.error(err?.data?.statusMessage || 'Could not remove the song from the playlist.');
  } finally {
    reordering.value = false;
  }
}

async function deletePlaylist() {
  if (deleting.value) return;
  deleting.value = true;
  try {
    await $fetch(base(), { method: 'DELETE' });
    toast.success('Playlist deleted');
    confirmingDelete.value = false;
    await router.push('/music/playlists');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not delete the playlist.');
  } finally {
    deleting.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.pd-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--space-4);
  text-decoration: none;
}

.pd-status {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.pd-title {
  margin: 0;
  overflow-wrap: anywhere;
}

.pd-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.pd-edit {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 480px;
}

.pd-edit-title {
  font-size: 18px;
  font-weight: 600;
}

.pd-edit-description {
  resize: vertical;
}

.pd-edit-actions {
  display: flex;
  gap: var(--space-2);
}

.pd-row-btn {
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

.pd-row-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.pd-row-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.pd-row-btn:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.pd-remove:hover:not(:disabled) {
  color: var(--accent-secondary);
}

.pd-confirm-text {
  margin: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 480px) {
  .pd-row-btn {
    width: 28px;
    height: 28px;
  }
}
</style>
