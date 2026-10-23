<template>
  <div class="channel-directory-view">
    <div class="dir-head">
      <div class="dir-head__title">
        <h1 class="page-title">{{ t('channels.titleChannels') }}</h1>
        <span v-if="!listPending && total > 0" class="dir-head__count" data-testid="dir-total">{{ totalLabel }}</span>
      </div>
      <form class="dir-toolbar" role="search" @submit.prevent="applySearchNow">
        <label class="dir-search">
          <span class="sr-only">{{ t('channels.search') }}</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input
            v-model="searchText"
            type="search"
            class="dir-search__input"
            :placeholder="t('channels.search')"
            maxlength="100"
            autocomplete="off"
            data-testid="dir-search"
          />
        </label>
        <label class="dir-select">
          <span class="sr-only">{{ t('channels.sortLabel') }}</span>
          <select class="form-input" :value="filters.sort" data-testid="dir-sort" @change="setFilters({ sort: ($event.target as HTMLSelectElement).value })">
            <option value="title">{{ t('channels.sortName') }}</option>
            <option value="videos">{{ t('channels.sortVideos') }}</option>
            <option value="recent">{{ t('channels.sortRecent') }}</option>
            <option v-if="isLoggedIn" value="watched">{{ t('channels.sortWatched') }}</option>
          </select>
        </label>
        <label v-if="isLoggedIn" class="dir-select">
          <span class="sr-only">{{ t('channels.showChannels') }}</span>
          <select class="form-input" :value="filters.following" data-testid="dir-following" @change="setFilters({ following: ($event.target as HTMLSelectElement).value })">
            <option value="">{{ t('channels.allChannelsLower') }}</option>
            <option value="1">{{ t('channels.following') }}</option>
            <option value="0">{{ t('channels.notFollowing') }}</option>
          </select>
        </label>
      </form>
    </div>

    <section v-if="showDiscover" class="dir-discover" aria-labelledby="dir-discover-title" data-testid="dir-discover">
      <h2 id="dir-discover-title" class="dir-section-title">{{ t('channels.discover') }}</h2>
      <div v-if="discoverPending" class="dir-discover__row" aria-hidden="true">
        <UiSkeleton v-for="n in 4" :key="n" height="128px" rounded="lg" class="dir-discover__item" />
      </div>
      <div v-else class="dir-discover__row">
        <ChannelDirectoryCard
          v-for="ch in discoverChannels"
          :key="ch.id"
          class="dir-discover__item"
          :channel="withSubscription(ch)"
          :reason="ch.reason"
          :can-subscribe="isLoggedIn"
          :active-category="filters.category"
          @category="selectCategory"
          @subscription="onSubscription"
        />
      </div>
    </section>

    <CategoryChipBar
      v-if="categoriesPending || categories.length > 0"
      :categories="categories"
      :model-value="filters.category"
      :loading="categoriesPending"
      class="dir-chips"
      @update:model-value="selectCategory"
    />

    <div v-if="listPending" class="dir-grid" aria-busy="true" data-testid="dir-loading">
      <div v-for="n in 6" :key="n" class="dir-skeleton">
        <div class="dir-skeleton__row">
          <UiSkeleton width="56px" height="56px" rounded="lg" />
          <div class="dir-skeleton__text">
            <UiSkeleton height="14px" width="70%" />
            <UiSkeleton height="12px" width="40%" />
          </div>
        </div>
        <UiSkeleton height="28px" width="100%" />
      </div>
    </div>

    <EmptyState
      v-else-if="listError"
      :title="t('channels.loadFailedTitle')"
      :description="t('channels.loadFailedDesc')"
      icon="channels"
      :action-text="t('common.tryAgain')"
      @action="refreshList()"
    />

    <EmptyState
      v-else-if="channels.length === 0 && isFiltered"
      data-testid="dir-no-match"
      :title="t('channels.noMatchTitle')"
      :description="t('channels.noMatchDesc')"
      icon="channels"
      :action-text="t('channels.clearFilters')"
      @action="clearFilters"
    />

    <EmptyState
      v-else-if="channels.length === 0"
      :title="t('channels.noneTitle')"
      :description="t('channels.noneDesc')"
      icon="channels"
      :action-text="isAdmin ? 'Add a channel' : undefined"
      action-route="/settings?tab=library&section=videos"
    />

    <template v-else>
      <div class="dir-grid" data-testid="dir-grid">
        <ChannelDirectoryCard
          v-for="ch in channels"
          :key="ch.id"
          :channel="withSubscription(ch)"
          :can-subscribe="isLoggedIn"
          :active-category="filters.category"
          @category="selectCategory"
          @subscription="onSubscription"
        />
      </div>
      <div v-if="channels.length < total" class="dir-more">
        <button type="button" class="btn btn-secondary" :disabled="loadingMore" data-testid="dir-show-more" @click="showMore">
          {{ loadingMore ? t('common.loading') : t('common.showMore') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import CategoryChipBar from '~/components/channels/CategoryChipBar.vue';
import ChannelDirectoryCard from '~/components/channels/ChannelDirectoryCard.vue';

// The channels directory: search, category chips, sort and "following"
// filters (all in the URL: ?q=, ?category=, ?sort=, ?following=), a grid
// paged with "Show more", and a Discover strip for signed-in viewers while no
// filter is active.
const PAGE_SIZE = 48;
const SORTS = ['title', 'videos', 'recent', 'watched'];
const SEARCH_DEBOUNCE_MS = 300;

const { t, locale } = useI18n();
const { isAdmin, isLoggedIn } = useAuth();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const requestFetch = useRequestFetch();

const one = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? '') : value == null ? '' : String(value));

// The URL is the source of truth; invalid values are ignored, never sent.
const filters = computed(() => {
  const sort = one(route.query.sort);
  const following = one(route.query.following);
  return {
    category: one(route.query.category).trim().slice(0, 40),
    q: one(route.query.q).trim().slice(0, 100),
    sort: SORTS.includes(sort) && (sort !== 'watched' || isLoggedIn.value) ? sort : 'title',
    following: isLoggedIn.value && (following === '1' || following === '0') ? following : '',
  };
});
const isFiltered = computed(() => !!(filters.value.category || filters.value.q || filters.value.following));

function setFilters(patch: Partial<Record<'category' | 'q' | 'sort' | 'following', string>>) {
  const query: Record<string, any> = { ...route.query, ...patch };
  for (const key of Object.keys(patch)) {
    if (!query[key] || (key === 'sort' && query[key] === 'title')) delete query[key];
  }
  router.replace({ query });
}

function selectCategory(name: string) {
  setFilters({ category: filters.value.category.toLowerCase() === name.toLowerCase() ? '' : name });
}

function clearFilters() {
  searchText.value = '';
  setFilters({ category: '', q: '', following: '' });
}

// Search box: debounced into ?q=, Enter applies at once.
const searchText = ref(filters.value.q);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchText, (text) => {
  if (searchTimer) clearTimeout(searchTimer);
  if (text.trim() === filters.value.q) return;
  searchTimer = setTimeout(() => setFilters({ q: text.trim() }), SEARCH_DEBOUNCE_MS);
});
watch(() => filters.value.q, (q) => {
  if (q !== searchText.value.trim()) searchText.value = q;
});
function applySearchNow() {
  if (searchTimer) clearTimeout(searchTimer);
  setFilters({ q: searchText.value.trim() });
}
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

const listParams = computed(() => ({
  ...(filters.value.category ? { category: filters.value.category } : {}),
  ...(filters.value.q ? { q: filters.value.q } : {}),
  ...(filters.value.sort !== 'title' ? { sort: filters.value.sort } : {}),
  ...(filters.value.following ? { following: filters.value.following } : {}),
}));

const { data: firstPage, pending: listPending, error: listError, refresh: refreshList } = await useAsyncData(
  'channel-directory',
  () => requestFetch<{ channels: any[]; total: number }>('/api/channels', { params: { ...listParams.value, page: 1, limit: PAGE_SIZE } }),
  { watch: [listParams] },
);

// Further pages ("Show more"), dropped whenever the filters change.
const morePages = ref<any[]>([]);
const loadingMore = ref(false);
let moreRequest = 0;
watch(listParams, () => {
  morePages.value = [];
  moreRequest++;
  loadingMore.value = false;
});

const channels = computed(() => {
  const seen = new Set<string>();
  return [...(firstPage.value?.channels ?? []), ...morePages.value].filter((c) => !seen.has(c.id) && seen.add(c.id));
});
const total = computed(() => firstPage.value?.total ?? 0);
const totalLabel = computed(() => t('channels.count', { count: total.value.toLocaleString(locale.value) }, total.value));

async function showMore() {
  if (loadingMore.value) return;
  loadingMore.value = true;
  const request = ++moreRequest;
  const page = Math.floor(channels.value.length / PAGE_SIZE) + 1;
  try {
    const res = await $fetch<{ channels: any[] }>('/api/channels', { params: { ...listParams.value, page, limit: PAGE_SIZE } });
    if (request === moreRequest) morePages.value = [...morePages.value, ...(res?.channels ?? [])];
  } catch (err: any) {
    if (request === moreRequest) toast.error(err?.data?.statusMessage || t('channels.loadMoreFailed'));
  } finally {
    if (request === moreRequest) loadingMore.value = false;
  }
}

const { data: categoryData, pending: categoriesPending } = await useAsyncData(
  'channel-categories',
  () => requestFetch<{ categories: { name: string; count: number }[] }>('/api/channels/categories'),
  { watch: [isLoggedIn] },
);
const categories = computed(() => categoryData.value?.categories ?? []);

// Discover: client-side only, for signed-in viewers.
const { data: discoverData, pending: discoverPending } = useLazyAsyncData(
  'channel-discover',
  () => (isLoggedIn.value ? $fetch<{ channels: any[] }>('/api/channels/discover') : Promise.resolve({ channels: [] })),
  { server: false, watch: [isLoggedIn] },
);
const discoverChannels = computed(() => discoverData.value?.channels ?? []);
const showDiscover = computed(() => isLoggedIn.value && !isFiltered.value && (discoverPending.value || discoverChannels.value.length > 0));

// A Subscribe click on one card (grid or Discover) shows on every card of that channel.
const subscriptionChanges = reactive(new Map<string, boolean>());
function onSubscription(id: string, subscribed: boolean) {
  subscriptionChanges.set(id, subscribed);
}
function withSubscription<T extends { id: string; subscribed?: boolean }>(ch: T): T {
  return subscriptionChanges.has(ch.id) ? { ...ch, subscribed: subscriptionChanges.get(ch.id) } : ch;
}
watch(firstPage, () => subscriptionChanges.clear());
</script>

<style scoped>
.channel-directory-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
/* The page is a column inside a fixed-height scroller: no row may shrink
   (the chip bar, an overflow-x scroller, was squashed to a few pixels). */
.channel-directory-view > * { flex-shrink: 0; }

.dir-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 20px;
}
.dir-head__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.dir-head__title .page-title { margin: 0; }
.dir-head__count {
  font-size: 13px;
  color: var(--text-secondary);
}

.dir-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 420px;
  justify-content: flex-end;
}
.dir-search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 220px;
  max-width: 340px;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
}
.dir-search:focus-within { border-color: var(--accent-primary); }
.dir-search__input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13.5px;
}
.dir-search__input:focus { outline: none; }
.dir-select { min-width: 0; }
.dir-select .form-input {
  height: 38px;
  padding: 0 36px 0 12px;
  background-position: right 10px center;
  font-size: 13px;
  max-width: 100%;
}

.dir-section-title {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 700;
}
.dir-discover__row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(min(280px, 85%), 1fr);
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 6px;
  scrollbar-width: thin;
}
.dir-discover__item { min-width: 0; }

.dir-chips { margin-top: 2px; }

.dir-grid {
  display: grid;
  /* min(): one column never wider than the content box on small phones. */
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  gap: 14px;
}
.dir-skeleton {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-color);
}
.dir-skeleton__row {
  display: flex;
  gap: 12px;
  align-items: center;
}
.dir-skeleton__text {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.dir-more {
  display: flex;
  justify-content: center;
  padding: 8px 0 24px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .dir-toolbar { justify-content: stretch; flex-basis: 100%; }
  .dir-search { max-width: none; flex-basis: 100%; }
  .dir-select { flex: 1 1 0; }
  .dir-select .form-input {
    width: 100%;
    padding: 0 26px 0 10px;
    background-position: right 6px center;
    background-size: 14px;
    font-size: 12.5px;
  }
}
</style>
