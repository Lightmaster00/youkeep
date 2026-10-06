<template>
  <details
    :id="`library-${config.kind}`"
    class="library-section glass-panel"
    :data-testid="`library-section-${config.kind}`"
    :open="open"
  >
    <summary class="library-section-summary">
      <span class="library-section-title">{{ config.title }}</span>
      <span class="section-desc">{{ config.description }}</span>
    </summary>

    <form class="ingest-form mt-3" data-testid="follow-search-form" @submit.prevent="onSubmit">
      <div class="search-input-wrapper">
        <input
          v-model="query"
          type="text"
          class="form-input settings-search-input"
          :placeholder="config.searchPlaceholder"
          :disabled="searching || adding"
          data-testid="follow-search-input"
        />
      </div>
      <button type="submit" class="btn btn-primary" :disabled="searching || adding" data-testid="follow-search-submit">
        {{ submitLabel }}
      </button>
    </form>

    <div v-if="results.length > 0" class="search-results-list mt-4">
      <h4 class="results-header">Results</h4>
      <div class="search-results-grid">
        <div v-for="(view, index) in resultViews" :key="index" class="search-channel-card">
          <img
            :src="view.imageUrl || '/img/default-avatar.png'"
            class="channel-avatar-thumb"
            referrerpolicy="no-referrer"
            alt=""
            @error="onImageError"
          />
          <div class="channel-search-info">
            <h5>{{ view.title }}</h5>
            <p v-if="view.meta" class="channel-search-meta">{{ view.meta }}</p>
            <p v-if="view.description" class="channel-search-desc">{{ view.description }}</p>
          </div>
          <button
            type="button"
            class="btn btn-primary btn-xs"
            :disabled="adding"
            :data-testid="`follow-result-${index}`"
            @click="followResult(results[index])"
          >Follow</button>
        </div>
      </div>
    </div>

    <details class="follow-options mt-3" data-testid="follow-options">
      <summary>Options for new follows</summary>
      <div class="follow-options-body">
        <label class="checkbox-container">
          <input v-model="options.autoSync" type="checkbox" data-testid="option-auto-sync" />
          <span class="checkmark"></span>
          Sync automatically (start downloading right away)
        </label>
        <div class="form-group">
          <label class="form-label" :for="`follow-visibility-${config.kind}`">Visibility</label>
          <select :id="`follow-visibility-${config.kind}`" v-model="options.visibility" class="form-select" data-testid="option-visibility">
            <option v-if="!config.hasVideoOptions" value="">Keep current (Public if new)</option>
            <option value="public">Public (everyone)</option>
            <option value="private">Private (signed-in users)</option>
            <option value="ultra_private">Ultra private (admins and chosen users)</option>
          </select>
        </div>
        <template v-if="config.hasVideoOptions">
          <div class="form-group">
            <span class="form-label">Download</span>
            <div class="follow-options-checks">
              <label class="checkbox-container"><input v-model="options.downloadVideos" type="checkbox" data-testid="option-videos" /><span class="checkmark"></span>Videos</label>
              <label class="checkbox-container"><input v-model="options.downloadShorts" type="checkbox" data-testid="option-shorts" /><span class="checkmark"></span>Shorts</label>
              <label class="checkbox-container"><input v-model="options.downloadLives" type="checkbox" data-testid="option-lives" /><span class="checkmark"></span>Live recordings</label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="follow-date-after">Only videos published after (optional)</label>
            <input id="follow-date-after" v-model="options.dateAfter" type="date" class="form-input" data-testid="option-date-after" />
          </div>
          <div class="form-group">
            <label class="form-label" for="follow-save-folder">Save folder</label>
            <div class="input-action-row">
              <input id="follow-save-folder" v-model="options.saveFolder" type="text" class="form-input" data-testid="option-save-folder" />
              <button type="button" class="btn btn-secondary-dark btn-sm" :disabled="savingDefaultFolder" data-testid="save-default-folder" @click="saveDefaultFolder">
                {{ savingDefaultFolder ? 'Saving...' : 'Save as default' }}
              </button>
            </div>
            <p class="section-desc">Each new channel gets its own folder inside this one.</p>
          </div>
        </template>
      </div>
    </details>

    <div class="following-block mt-4">
      <div class="following-head">
        <h4 class="results-header">Following ({{ rows.length }})</h4>
        <button
          type="button"
          class="btn btn-secondary-dark btn-sm"
          :disabled="syncingAll || rows.length === 0"
          data-testid="sync-all"
          @click="onSyncAll"
        >{{ syncingAll ? 'Starting...' : 'Sync all' }}</button>
      </div>

      <p v-if="!loaded" class="section-desc mt-2" data-testid="following-loading">Loading…</p>
      <p v-else-if="listError" class="settings-error-msg mt-2" data-testid="following-error">Couldn't load the list. Reload the page to try again.</p>
      <p v-else-if="rows.length === 0" class="section-desc mt-2" data-testid="following-empty">{{ config.emptyFollowingMessage }}</p>
      <ul v-else class="following-list">
        <li v-for="row in rows" :key="row.id" class="following-row" :data-testid="`following-${row.id}`">
          <img
            :src="row.imageUrl || '/img/default-avatar.png'"
            class="channel-avatar-thumb"
            referrerpolicy="no-referrer"
            alt=""
            @error="onImageError"
          />
          <div class="following-info">
            <NuxtLink :to="row.href" class="following-name">{{ row.name }}</NuxtLink>
            <span class="section-desc">{{ row.countLabel }}</span>
          </div>
          <label class="following-sync" :title="row.syncActive ? 'New items download automatically' : 'Nothing new is downloaded'">
            <input
              type="checkbox"
              :checked="row.syncActive"
              :disabled="isBusy(row.id)"
              :data-testid="`sync-switch-${row.id}`"
              @change="onToggleSync(row, $event)"
            />
            <span>{{ row.syncActive ? 'Active' : 'Paused' }}</span>
          </label>
          <button
            type="button"
            class="btn btn-secondary-dark btn-xs"
            :disabled="isBusy(row.id)"
            :data-testid="`sync-now-${row.id}`"
            @click="onSyncNow(row)"
          >Sync now</button>
          <select
            v-if="config.visibilityUrl"
            class="form-select following-visibility"
            :value="row.visibility"
            :disabled="isBusy(row.id)"
            :data-testid="`visibility-${row.id}`"
            @change="onVisibilityChange(row, $event)"
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
            <option value="ultra_private">Ultra private</option>
          </select>
          <span v-else class="badge visibility-badge" :data-testid="`visibility-${row.id}`">{{ visibilityLabel(row.visibility) }}</span>
          <button
            v-if="config.hasVideoOptions"
            type="button"
            class="btn btn-secondary-dark btn-xs"
            :data-testid="`edit-options-${row.id}`"
            @click="editingRow = row"
          >Edit options</button>
        </li>
      </ul>
    </div>

    <ChannelOptionsModal
      v-if="config.hasVideoOptions"
      :channel-id="editingRow?.id ?? null"
      :channel-name="editingRow?.name ?? ''"
      @close="editingRow = null"
      @saved="loadFollowing"
    />
  </details>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import ChannelOptionsModal from '~/components/settings/ChannelOptionsModal.vue';
import {
  DEFAULT_SAVE_FOLDER, defaultFollowOptions, visibilityLabel,
  type FollowedSource, type FollowOptions, type LibrarySourceConfig,
} from '~/utils/librarySources';

const props = withDefaults(defineProps<{ config: LibrarySourceConfig; open?: boolean }>(), { open: true });

const toast = useToast();

const query = ref('');
const searching = ref(false);
const results = ref<any[]>([]);
const adding = ref(false);
const options = reactive<FollowOptions>(defaultFollowOptions(props.config.kind));
const rows = ref<FollowedSource[]>([]);
const listError = ref(false);
const busyRows = reactive(new Set<string>());
const loaded = ref(false);
const isBusy = (id: string) => busyRows.has(id);
const syncingAll = ref(false);
const editingRow = ref<FollowedSource | null>(null);
const savingDefaultFolder = ref(false);

async function loadDefaultFolder() {
  try {
    const data = await $fetch<{ path?: string }>('/api/admin/downloader/default-dir');
    options.saveFolder = data?.path || DEFAULT_SAVE_FOLDER;
  } catch {
    options.saveFolder = DEFAULT_SAVE_FOLDER;
  }
}

async function saveDefaultFolder() {
  const path = options.saveFolder.trim();
  if (!path) {
    toast.error('Enter a folder first.');
    return;
  }
  savingDefaultFolder.value = true;
  try {
    await $fetch('/api/admin/downloader/default-dir', { method: 'POST', body: { path } });
    toast.success('Default save folder updated.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the default folder.');
    await loadDefaultFolder();
  } finally {
    savingDefaultFolder.value = false;
  }
}

async function onVisibilityChange(row: FollowedSource, event: Event) {
  const select = event.target as HTMLSelectElement;
  const visibility = select.value;
  const url = props.config.visibilityUrl;
  if (!url) return;
  if (busyRows.has(row.id)) {
    select.value = rowAfterReload(row).visibility;
    return;
  }
  busyRows.add(row.id);
  try {
    await $fetch(url(row.id), { method: 'PUT', body: { visibility } });
    toast.success(`${row.name} is now ${visibilityLabel(visibility).toLowerCase()}.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not change the visibility.');
  } finally {
    await loadFollowing();
    // One-way binding: put the select back to what the server kept.
    select.value = rowAfterReload(row).visibility;
    busyRows.delete(row.id);
  }
}

const resultViews = computed(() => results.value.map((raw) => props.config.toResultView(raw)));
const submitLabel = computed(() => {
  if (searching.value) return 'Searching...';
  if (adding.value) return 'Following...';
  return props.config.directTarget(query.value) ? 'Follow' : 'Search';
});

function onImageError(event: Event) {
  const target = event.target as HTMLImageElement | null;
  if (target) target.src = '/img/default-avatar.png';
}

async function loadFollowing() {
  try {
    const data = await $fetch<any>(props.config.listEndpoint);
    rows.value = props.config.readFollowing(data);
    listError.value = false;
  } catch {
    listError.value = true;
  } finally {
    loaded.value = true;
  }
}

async function onSubmit() {
  const q = query.value.trim();
  if (!q) return;

  const direct = props.config.directTarget(q);
  if (direct) {
    if (await follow(direct, null)) query.value = '';
    return;
  }

  searching.value = true;
  results.value = [];
  try {
    const data = await $fetch<any>(props.config.searchEndpoint, { params: { q } });
    results.value = props.config.readSearchResults(data);
    if (results.value.length === 0) toast.info(props.config.noResultsMessage);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Search failed.');
  } finally {
    searching.value = false;
  }
}

async function followResult(raw: any) {
  if (adding.value) return;
  const target = props.config.followTarget(raw);
  if (!target) {
    toast.error(props.config.noTargetMessage);
    return;
  }
  // Results stay on screen when the add fails, so Follow can be retried.
  if (await follow(target, raw)) results.value = [];
}

// Re-entrancy guard: `adding` is set synchronously, before the first await,
// so a second click in the same tick is ignored.
async function follow(target: string, raw: any | null): Promise<boolean> {
  if (adding.value) return false;
  adding.value = true;
  try {
    await $fetch(props.config.ingestEndpoint, {
      method: 'POST',
      body: props.config.buildIngestBody(target, options, raw),
    });
    toast.success(`Now following ${raw ? props.config.toResultView(raw).title : target}.`);
    await loadFollowing();
    return true;
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not follow. Check the address and try again.');
    return false;
  } finally {
    adding.value = false;
  }
}

function rowAfterReload(row: FollowedSource): FollowedSource {
  return rows.value.find((r) => r.id === row.id) ?? row;
}

async function onToggleSync(row: FollowedSource, event: Event) {
  const input = event.target as HTMLInputElement;
  if (busyRows.has(row.id)) {
    input.checked = rowAfterReload(row).syncActive;
    return;
  }
  const wantActive = input.checked;
  busyRows.add(row.id);
  try {
    await $fetch(wantActive ? props.config.syncUrl(row.id) : props.config.pauseUrl(row.id), { method: 'POST' });
    toast.success(wantActive ? `${row.name} is active.` : `${row.name} is paused.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not change the sync state.');
  } finally {
    await loadFollowing();
    // One-way binding: the browser already flipped the box, force it back to server truth.
    input.checked = rowAfterReload(row).syncActive;
    busyRows.delete(row.id);
  }
}

async function onSyncNow(row: FollowedSource) {
  if (busyRows.has(row.id)) return;
  busyRows.add(row.id);
  try {
    await $fetch(props.config.syncUrl(row.id), { method: 'POST' });
    toast.success(`Sync started for ${row.name}.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || `Could not sync ${row.name}.`);
  } finally {
    busyRows.delete(row.id);
    await loadFollowing();
  }
}

async function onSyncAll() {
  syncingAll.value = true;
  try {
    const res = await $fetch<{ success?: boolean }>(props.config.syncAllEndpoint, { method: 'POST' });
    if (res?.success === false) toast.info('A sync is already running.');
    else toast.success(props.config.syncAllStartedMessage);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not start the sync.');
  } finally {
    syncingAll.value = false;
    await loadFollowing();
  }
}

onMounted(() => {
  loadFollowing();
  if (props.config.hasVideoOptions) loadDefaultFolder();
});

defineExpose({ loadFollowing });
</script>

<style scoped>
.library-section { padding: 20px; display: flex; flex-direction: column; }
.library-section-summary { cursor: pointer; display: flex; flex-direction: column; gap: 4px; list-style-position: outside; }
.library-section-title { font-size: 18px; font-weight: 700; }
.follow-options { border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 12px; }
.follow-options > summary { cursor: pointer; font-weight: 600; font-size: 14px; }
.follow-options-body { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.following-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.following-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.following-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.following-info { display: flex; flex-direction: column; flex: 1 1 160px; min-width: 0; }
.following-name { font-weight: 600; color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.following-name:hover { text-decoration: underline; }
.following-sync { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; }
.visibility-badge { font-size: 12px; }
.follow-options-checks { display: flex; gap: 16px; flex-wrap: wrap; }
.following-visibility { width: auto; min-width: 120px; }
</style>
