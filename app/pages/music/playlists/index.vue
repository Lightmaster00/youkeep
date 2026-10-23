<template>
  <div class="user-playlists-page">
    <header class="upl-header">
      <h1 class="page-title">{{ t('nav.playlists') }}</h1>
      <button v-if="!showForm" type="button" class="btn btn-primary upl-new-btn" @click="openForm">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        {{ t('music.userPlaylists.new') }}
      </button>
    </header>

    <form v-if="showForm" class="upl-form glass-panel" @submit.prevent="create">
      <label class="upl-label" for="upl-title">{{ t('music.userPlaylists.name') }}</label>
      <input
        id="upl-title"
        ref="titleInput"
        v-model="newTitle"
        type="text"
        class="form-input"
        :placeholder="t('music.userPlaylists.namePlaceholder')"
        :maxlength="PLAYLIST_TITLE_MAX"
      />
      <label class="upl-label" for="upl-description">{{ t('music.userPlaylists.description') }}</label>
      <textarea
        id="upl-description"
        v-model="newDescription"
        class="form-input upl-textarea"
        rows="2"
        :maxlength="PLAYLIST_DESCRIPTION_MAX"
      ></textarea>
      <div class="upl-form-actions">
        <button type="button" class="btn btn-secondary" @click="closeForm">{{ t('common.cancel') }}</button>
        <button type="submit" class="btn btn-primary" :disabled="creating || !newTitle.trim()">{{ t('common.create') }}</button>
      </div>
    </form>

    <div v-if="pending" class="upl-status">{{ t('common.loadingDots') }}</div>
    <div v-else-if="loadError" class="upl-status">
      {{ t('music.userPlaylists.loadFailed') }}
      <button class="btn btn-secondary" @click="load">{{ t('common.retry') }}</button>
    </div>
    <EmptyState
      v-else-if="playlists.length === 0"
      icon="folder"
      :title="t('music.userPlaylists.emptyTitle')"
      :description="t('music.userPlaylists.emptyDesc')"
    />
    <div v-else class="upl-grid">
      <NuxtLink
        v-for="p in playlists"
        :key="p.id"
        :to="`/music/playlists/${p.id}`"
        class="upl-card"
      >
        <PlaylistCoverMosaic :urls="p.coverUrls" class="upl-cover" />
        <span class="upl-card-title">{{ p.title }}</span>
        <span class="upl-card-meta">{{ t('music.songCount', { count: p.trackCount.toLocaleString(locale) }, p.trackCount) }}</span>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { PLAYLIST_TITLE_MAX, PLAYLIST_DESCRIPTION_MAX } from '#shared/musicPlaylists';

const { t, locale } = useI18n();
useHead({ title: computed(() => t('music.head.playlists')) });

interface PlaylistEntry { id: string; title: string; trackCount: number; coverUrls: string[] }

const toast = useToast();
const playlists = ref<PlaylistEntry[]>([]);
const pending = ref(true);
const loadError = ref(false);
const showForm = ref(false);
const newTitle = ref('');
const newDescription = ref('');
const creating = ref(false);
const titleInput = ref<HTMLInputElement | null>(null);

async function load() {
  pending.value = true;
  loadError.value = false;
  try {
    playlists.value = (await $fetch<PlaylistEntry[]>('/api/music/user-playlists')) || [];
  } catch {
    loadError.value = true;
  } finally {
    pending.value = false;
  }
}

async function openForm() {
  showForm.value = true;
  await nextTick();
  titleInput.value?.focus();
}

function closeForm() {
  showForm.value = false;
  newTitle.value = '';
  newDescription.value = '';
}

async function create() {
  const title = newTitle.value.trim();
  if (!title || creating.value) return;
  creating.value = true;
  try {
    const created = await $fetch<PlaylistEntry>('/api/music/user-playlists', {
      method: 'POST',
      body: { title, description: newDescription.value.trim() || null },
    });
    playlists.value = [created, ...playlists.value];
    toast.success(t('music.userPlaylists.created', { title: created.title }));
    closeForm();
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || t('music.userPlaylists.createFailed'));
  } finally {
    creating.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.upl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}

.upl-header .page-title {
  margin: 0;
}

.upl-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.upl-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 480px;
  padding: var(--space-4);
  margin-bottom: var(--space-5);
  border-radius: var(--border-radius-md);
}

.upl-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.upl-textarea {
  resize: vertical;
}

.upl-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.upl-status {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.upl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
  gap: 16px;
}

.upl-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  color: inherit;
  text-decoration: none;
  transition: border-color var(--duration-base) var(--ease-standard), background var(--duration-base) var(--ease-standard);
}

.upl-card:hover,
.upl-card:focus-visible {
  border-color: rgba(139, 92, 246, 0.3);
  background: rgba(28, 24, 38, 0.6);
}

.upl-cover {
  margin-bottom: 8px;
}

.upl-card-title {
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upl-card-meta {
  font-size: 13px;
  color: var(--text-secondary);
}

@media (max-width: 640px) {
  .upl-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
}
</style>
