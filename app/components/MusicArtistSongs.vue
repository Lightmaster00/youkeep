<template>
  <div class="mas">
    <div class="mas-toolbar">
      <label class="mas-sort-label" for="artist-songs-sort">Sort by</label>
      <select id="artist-songs-sort" v-model="sort" class="form-input mas-sort" data-testid="songs-sort">
        <option value="popular">Popular</option>
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="title">A–Z</option>
      </select>
    </div>

    <EmptyState
      v-if="loaded && items.length === 0 && !error"
      icon="music"
      title="No songs yet"
      description="Songs of this artist appear here once they are downloaded."
    />
    <MusicTrackList
      v-else
      :tracks="items"
      :active-id="currentTrack?.id"
      @play="(track) => playFrom(track, items)"
    >
      <template #actions="{ track }">
        <MusicTrackExtras :track="track" :list="items" @edit="(t) => emit('edit', t)" />
      </template>
    </MusicTrackList>

    <div v-if="loading" class="mas-status">Loading...</div>
    <div v-else-if="error" class="mas-status">
      Failed to load songs.
      <button type="button" class="btn btn-secondary" @click="loadMore">Retry</button>
    </div>
    <div v-else-if="hasMore" class="mas-more">
      <button type="button" class="btn btn-secondary" data-testid="songs-load-more" @click="loadMore">Load more</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { usePlayTrackList } from '~/composables/usePlayTrackList';

// Songs tab of the artist page: every downloaded track of the artist, whether or
// not it belongs to an album, sortable, paged with "Load more".
const props = defineProps<{ artistId: string }>();
const emit = defineEmits<{ edit: [track: any] }>();

const PAGE_SIZE = 50;

const { playFrom, currentTrack } = usePlayTrackList();

const sort = ref<'popular' | 'newest' | 'oldest' | 'title'>('popular');
const items = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref(false);
const loaded = ref(false);
const hasMore = computed(() => items.value.length < total.value);

// A sort change starts a new list; answers to an older request are dropped.
let requestId = 0;

async function loadMore() {
  const id = ++requestId;
  loading.value = true;
  error.value = false;
  try {
    const data = await $fetch<any>(`/api/music/artists/${props.artistId}/songs`, {
      params: { sort: sort.value, limit: PAGE_SIZE, offset: items.value.length }
    });
    if (id !== requestId) return;
    items.value.push(...(data?.items || []));
    total.value = data?.total || 0;
    loaded.value = true;
  } catch {
    if (id !== requestId) return;
    error.value = true;
  } finally {
    if (id === requestId) loading.value = false;
  }
}

watch(sort, () => {
  items.value = [];
  total.value = 0;
  loaded.value = false;
  loadMore();
});

onMounted(loadMore);
</script>

<style scoped>
.mas-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.mas-sort-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.mas-sort {
  width: auto;
  min-width: 0;
}

.mas-status {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.mas-more {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}
</style>
