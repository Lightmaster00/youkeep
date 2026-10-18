<template>
  <BaseModal :show="show" title="Save to playlist" @close="emit('close')">
    <p class="stp-desc">Choose the playlists for <strong>{{ videoTitle || 'this video' }}</strong>:</p>

    <div v-if="loading" class="stp-empty">Loading playlists...</div>
    <div v-else-if="ownPlaylists.length === 0" class="stp-empty" data-testid="stp-empty">
      You have no playlists yet. Create one below.
    </div>
    <ul v-else class="stp-list" data-testid="stp-list">
      <li v-for="pl in ownPlaylists" :key="pl.id">
        <label class="stp-item">
          <input
            type="checkbox"
            :checked="pl.contains_video === 1 || pl.contains_video === true"
            :disabled="busyId === pl.id"
            @change="toggle(pl, ($event.target as HTMLInputElement).checked, $event)"
          />
          <span class="stp-item-text">
            <span class="stp-item-name">{{ pl.title }}</span>
            <span class="stp-item-vis">{{ visibilityLabel(pl.visibility) }}</span>
          </span>
        </label>
      </li>
    </ul>

    <div class="stp-create">
      <button v-if="!showForm" type="button" class="btn btn-secondary stp-full" @click="openForm">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        Create new playlist
      </button>
      <form v-else class="stp-form" @submit.prevent="create">
        <label class="stp-label" :for="titleInputId">Playlist title</label>
        <input :id="titleInputId" ref="titleInput" v-model="newTitle" class="form-input" maxlength="200" />
        <label class="stp-label" :for="visInputId">Visibility</label>
        <select :id="visInputId" v-model="newVisibility" class="form-input">
          <option value="private">Private</option>
          <option value="unlisted">Unlisted</option>
          <option value="public">Public</option>
        </select>
        <div class="stp-form-actions">
          <button type="submit" class="btn btn-primary" :disabled="!newTitle.trim() || creating">
            {{ creating ? 'Creating...' : 'Create' }}
          </button>
          <button type="button" class="btn btn-secondary" @click="showForm = false">Cancel</button>
        </div>
      </form>
    </div>

    <template #footer>
      <button type="button" class="btn btn-primary" @click="emit('close')">Done</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
// "Save to playlist" for one video: only the signed-in user's OWN playlists
// (the list endpoint also returns other users' public playlists, which a
// member may view but never edit).
import { ref, computed, watch, nextTick } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';

const props = defineProps<{ show: boolean; videoId: string; videoTitle?: string }>();
const emit = defineEmits<{ close: [] }>();

const { user } = useAuth();
const toast = useToast();

const uid = `stp-${Math.random().toString(36).slice(2, 8)}`;
const titleInputId = `${uid}-title`;
const visInputId = `${uid}-vis`;

const playlists = ref<any[]>([]);
const loading = ref(false);
const busyId = ref('');
const showForm = ref(false);
const newTitle = ref('');
const newVisibility = ref('private');
const creating = ref(false);
const titleInput = ref<HTMLInputElement | null>(null);

const ownPlaylists = computed(() => {
  const me = user.value?.username;
  return playlists.value.filter((p) => p.owner_name === undefined || p.owner_name === me);
});

function visibilityLabel(v: string) {
  return v === 'public' ? 'Public' : v === 'unlisted' ? 'Unlisted' : 'Private';
}

async function load() {
  loading.value = true;
  try {
    const data = await $fetch<any>('/api/playlists/personal', { params: { videoId: props.videoId } });
    playlists.value = data?.playlists || [];
  } catch {
    playlists.value = [];
    toast.error('Failed to load playlists.');
  } finally {
    loading.value = false;
  }
}

watch(() => [props.show, props.videoId] as const, ([shown]) => {
  if (shown) {
    showForm.value = false;
    load();
  }
}, { immediate: true });

async function toggle(pl: any, checked: boolean, event?: Event) {
  busyId.value = pl.id;
  try {
    await $fetch(`/api/playlists/personal/${encodeURIComponent(pl.id)}/videos`, {
      method: 'POST',
      body: { action: checked ? 'add' : 'remove', videoId: props.videoId },
    });
    pl.contains_video = checked ? 1 : 0;
    toast.success(checked ? `Added to ${pl.title}.` : `Removed from ${pl.title}.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Failed to update the playlist.');
    if (event) (event.target as HTMLInputElement).checked = !checked;
  } finally {
    busyId.value = '';
  }
}

async function openForm() {
  showForm.value = true;
  await nextTick();
  titleInput.value?.focus();
}

async function create() {
  const title = newTitle.value.trim();
  if (!title || creating.value) return;
  creating.value = true;
  try {
    const { playlist } = await $fetch<any>('/api/playlists/personal', {
      method: 'POST',
      body: { title, visibility: newVisibility.value, description: '' },
    });
    await $fetch(`/api/playlists/personal/${encodeURIComponent(playlist.id)}/videos`, {
      method: 'POST',
      body: { action: 'add', videoId: props.videoId },
    });
    playlists.value.unshift({ ...playlist, owner_name: user.value?.username, contains_video: 1 });
    toast.success('Playlist created and video added.');
    newTitle.value = '';
    newVisibility.value = 'private';
    showForm.value = false;
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Failed to create the playlist.');
  } finally {
    creating.value = false;
  }
}
</script>

<style scoped>
.stp-desc { margin: 0; font-size: 13px; color: var(--text-secondary); overflow-wrap: anywhere; }
.stp-empty { text-align: center; color: var(--text-muted); font-size: 13px; padding: 16px 0; }
.stp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; }
.stp-item {
  display: flex; gap: 12px; align-items: center; padding: 10px 12px; border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.04); cursor: pointer;
}
.stp-item:hover { background: rgba(139, 92, 246, 0.05); border-color: rgba(139, 92, 246, 0.2); }
.stp-item input { width: 18px; height: 18px; accent-color: var(--accent-primary); flex-shrink: 0; }
.stp-item-text { display: flex; flex-direction: column; min-width: 0; }
.stp-item-name { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
.stp-item-vis { font-size: 11px; color: var(--text-muted); }
.stp-create { border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 16px; }
.stp-full { width: 100%; justify-content: center; }
.stp-form { display: flex; flex-direction: column; gap: 6px; }
.stp-label { font-size: 12px; color: var(--text-secondary); }
.stp-form-actions { display: flex; gap: 8px; margin-top: 6px; }
.stp-form-actions .btn-primary { flex: 1; justify-content: center; }
</style>
