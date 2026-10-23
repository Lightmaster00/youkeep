<template>
  <div class="subs-latest">
    <div class="subs-toolbar">
      <div class="subs-filters">
        <label v-if="categories.length > 0" class="subs-filter">
          <span class="subs-filter__label">{{ t('subscriptions.category') }}</span>
          <select v-model="category" class="form-input subs-select" data-testid="subs-category">
            <option value="">{{ t('subscriptions.allCategories') }}</option>
            <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
          </select>
        </label>
        <label class="subs-filter">
          <span class="subs-filter__label">{{ t('subscriptions.sort') }}</span>
          <select v-model="sort" class="form-input subs-select" data-testid="subs-sort">
            <option value="new">{{ t('subscriptions.sortNew') }}</option>
            <option value="popular">{{ t('subscriptions.sortPopular') }}</option>
            <option value="oldest">{{ t('subscriptions.sortOld') }}</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        data-testid="subs-mark-all-seen"
        :disabled="markingAll || !(hasNew || anyNew)"
        @click="markAllSeen"
      >{{ markingAll ? t('subscriptions.marking') : t('subscriptions.markAllSeen') }}</button>
    </div>

    <!-- Loading: a grid of placeholders the size of the cards. -->
    <div v-if="pending" class="subs-grid" data-testid="subs-loading" aria-busy="true">
      <div v-for="n in 8" :key="n" class="subs-skeleton" aria-hidden="true">
        <div class="subs-skeleton__media"></div>
        <UiSkeleton height="14px" width="85%" />
        <UiSkeleton height="12px" width="50%" />
      </div>
    </div>

    <p v-else-if="loadError" class="subs-empty" role="alert">{{ loadError }}</p>

    <template v-else>
      <section class="subs-section" data-testid="subs-videos" :aria-label="t('subscriptions.videos')">
        <p v-if="videos.length === 0" class="subs-empty" data-testid="subs-videos-empty">
          {{ filtered ? t('subscriptions.noMatch') : t('subscriptions.noLong') }}
        </p>
        <div v-for="group in groups" :key="group.key" class="subs-day" :data-testid="`subs-day-${group.bucket}`">
          <h2 v-if="group.label" class="subs-day__title">{{ t(`subscriptions.day.${group.bucket}`) }}</h2>
          <div class="subs-grid">
            <div
              v-for="video in group.items"
              :key="video.id"
              v-seen="video"
              class="subs-card"
              :data-testid="`subs-card-${video.id}`"
              @click.capture="onOpen(video)"
              @auxclick.capture="onOpen(video)"
            >
              <VideoCard :video="video" @hidden="onHidden">
                <template v-if="video.watchedPercent > 0" #thumbnail-overlay>
                  <span class="watched-bar" aria-hidden="true"><span class="watched-bar__fill" :style="{ width: `${video.watchedPercent}%` }"></span></span>
                </template>
                <template #info-extra>
                  <span v-if="video.isNew" class="new-mark" data-testid="new-dot">{{ t('common.new') }}</span>
                </template>
              </VideoCard>
            </div>
          </div>
        </div>
        <div v-if="videos.length < total" class="subs-more">
          <button type="button" class="btn btn-secondary" data-testid="subs-videos-more" :disabled="loadingMore" @click="loadMore('video')">
            {{ loadingMore ? t('common.loadingDots') : t('common.showMore') }}
          </button>
        </div>
      </section>

      <!-- Shorts: their own section, fetched apart, never mixed in above. -->
      <section v-if="shorts.length > 0" class="subs-section" data-testid="subs-shorts" aria-labelledby="subs-shorts-title">
        <h2 id="subs-shorts-title" class="subs-section-title">{{ t('nav.shorts') }}</h2>
        <div class="video-shorts-grid">
          <div
            v-for="video in shorts"
            :key="video.id"
            v-seen="video"
            class="subs-card"
            :data-testid="`subs-card-${video.id}`"
            @click.capture="onOpen(video)"
            @auxclick.capture="onOpen(video)"
          >
            <VideoCard :video="video" @hidden="onHidden">
              <template #info-extra>
                <span v-if="video.isNew" class="new-mark" data-testid="new-dot">{{ t('common.new') }}</span>
              </template>
            </VideoCard>
          </div>
        </div>
        <div v-if="shorts.length < shortsTotal" class="subs-more">
          <button type="button" class="btn btn-secondary" data-testid="subs-shorts-more" :disabled="loadingMoreShorts" @click="loadMore('short')">
            {{ loadingMoreShorts ? t('common.loadingDots') : t('subscriptions.showMoreShorts') }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { apiErrorMessage } from '~/utils/apiError';
import { computed, onMounted, ref, watch, type Directive } from 'vue';
import { groupByUploadDay } from '~/utils/dayGroups';
import { useSeenTracker } from '~/composables/useSeenTracker';
import { useToast } from '~/composables/useToast';

// The Latest tab of the Subscriptions page: the followed channels' long
// videos (by day, with a New mark until seen), filters, "Mark all as seen",
// then their Shorts in a section of their own.
const props = defineProps<{
  channelId: string;
  categories: string[];
  loggedIn: boolean;
  /** Bumped by the page when the followed channels change. */
  reloadKey?: number;
  /** A followed channel has new videos (maybe beyond the loaded pages). */
  anyNew?: boolean;
}>();
const emit = defineEmits<{ (e: 'all-seen'): void }>();

const { t } = useI18n();
const VIDEO_LIMIT = 24;
const SHORT_LIMIT = 12;

const toast = useToast();
const sort = ref<'new' | 'popular' | 'oldest'>('new');
const category = ref('');
const videos = ref<any[]>([]);
const total = ref(0);
const shorts = ref<any[]>([]);
const shortsTotal = ref(0);
const pending = ref(true);
const loadError = ref('');
const loadingMore = ref(false);
const loadingMoreShorts = ref(false);
const markingAll = ref(false);
let videoPage = 1;
let shortsPage = 1;
let requestId = 0;

const filtered = computed(() => !!category.value || !!props.channelId);
const hasNew = computed(() => videos.value.some((v) => v.isNew) || shorts.value.some((v) => v.isNew));

// Popularity has no time order, so no day headings then.
const groups = computed(() => (sort.value === 'popular'
  ? (videos.value.length ? [{ key: 'all', bucket: 'all', label: '', items: videos.value }] : [])
  : groupByUploadDay(videos.value).map((g, i) => ({ ...g, key: `${g.bucket}-${i}` }))));

const tracker = useSeenTracker({ enabled: () => props.loggedIn });

// v-seen="video": watch the card while its video is still new.
const vSeen: Directive<HTMLElement, any> = {
  mounted(el, binding) {
    if (binding.value?.isNew) tracker.observe(el, binding.value.id);
  },
  updated(el, binding) {
    if (!binding.value?.isNew) tracker.unobserve(el);
  },
  beforeUnmount(el) {
    tracker.unobserve(el);
  },
};

function onOpen(video: any) {
  if (video.isNew) tracker.markOpened(video.id);
}

function fetchPage(type: 'video' | 'short', page: number) {
  return $fetch<{ videos: any[]; total: number }>('/api/subscriptions/feed', {
    params: {
      channelId: props.channelId || undefined,
      category: category.value || undefined,
      sort: sort.value,
      type,
      page,
      limit: type === 'video' ? VIDEO_LIMIT : SHORT_LIMIT,
    },
  });
}

async function load() {
  const id = ++requestId;
  pending.value = true;
  loadError.value = '';
  videoPage = 1;
  shortsPage = 1;
  try {
    // A Shorts failure only hides their section.
    const [long, short] = await Promise.all([fetchPage('video', 1), fetchPage('short', 1).catch(() => null)]);
    if (id !== requestId) return;
    videos.value = long?.videos ?? [];
    total.value = long?.total ?? 0;
    shorts.value = short?.videos ?? [];
    shortsTotal.value = short?.total ?? 0;
  } catch (err: any) {
    if (id !== requestId) return;
    videos.value = [];
    shorts.value = [];
    total.value = 0;
    shortsTotal.value = 0;
    loadError.value = apiErrorMessage(err, t, 'subscriptions.loadFailed');
  } finally {
    if (id === requestId) pending.value = false;
  }
}

async function loadMore(type: 'video' | 'short') {
  const busy = type === 'video' ? loadingMore : loadingMoreShorts;
  if (busy.value || pending.value) return;
  busy.value = true;
  const id = requestId;
  const page = (type === 'video' ? videoPage : shortsPage) + 1;
  try {
    const res = await fetchPage(type, page);
    if (id !== requestId) return;
    const list = type === 'video' ? videos : shorts;
    const known = new Set(list.value.map((v) => v.id));
    list.value = [...list.value, ...(res?.videos ?? []).filter((v) => !known.has(v.id))];
    if (type === 'video') {
      videoPage = page;
      total.value = res?.total ?? total.value;
    } else {
      shortsPage = page;
      shortsTotal.value = res?.total ?? shortsTotal.value;
    }
  } catch (err: any) {
    toast.error(apiErrorMessage(err, t, 'subscriptions.loadMoreFailed'));
  } finally {
    busy.value = false;
  }
}

async function markAllSeen() {
  if (markingAll.value) return;
  markingAll.value = true;
  try {
    await $fetch('/api/subscriptions/mark-all-seen', { method: 'POST' });
    tracker.forget([...videos.value, ...shorts.value].map((v) => v.id));
    videos.value = videos.value.map((v) => (v.isNew ? { ...v, isNew: false } : v));
    shorts.value = shorts.value.map((v) => (v.isNew ? { ...v, isNew: false } : v));
    emit('all-seen');
  } catch (err: any) {
    toast.error(apiErrorMessage(err, t, 'subscriptions.markFailed'));
  } finally {
    markingAll.value = false;
  }
}

function onHidden(id: string) {
  videos.value = videos.value.filter((v) => v.id !== id);
  shorts.value = shorts.value.filter((v) => v.id !== id);
}

watch([() => props.channelId, () => props.reloadKey, sort, category], () => { void load(); });
onMounted(load);
</script>

<style scoped>
.subs-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.subs-filters {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}

.subs-filter {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.subs-filter__label {
  font-size: 12px;
  color: var(--text-secondary);
}

.subs-select {
  width: auto;
  min-width: 150px;
  max-width: 100%;
  padding-top: 7px;
  padding-bottom: 7px;
}

.subs-section { margin-bottom: 36px; }

.subs-section-title,
.subs-day__title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 14px;
}
.subs-day { margin-bottom: 28px; }
.subs-day__title { font-size: 16px; color: var(--text-secondary); }

.subs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(calc(260px * var(--grid-min-scale, 1)), 100%), 1fr));
  gap: 22px 18px;
}

.subs-card { min-width: 0; }

.new-mark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #c4b5fd;
}
.new-mark::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.2);
}

.watched-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: rgba(255, 255, 255, 0.25);
  z-index: 3;
}
.watched-bar__fill {
  display: block;
  height: 100%;
  background: #ff3355;
}

.subs-empty {
  color: var(--text-secondary);
  font-size: 14px;
  padding: 12px 0;
}

.subs-more {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

.subs-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subs-skeleton__media {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  margin-bottom: 4px;
  background: rgba(255, 255, 255, 0.05);
}

@media (max-width: 480px) {
  .subs-filters { width: 100%; }
  .subs-filter { flex: 1 1 110px; }
  .subs-select { width: 100%; min-width: 0; }
}
</style>
