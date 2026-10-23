<template>
  <div class="home-container">

    <!-- Loading: the hero and each chosen row hold their place. -->
    <div v-if="loading" class="netflix-feed" data-testid="home-loading">
      <div v-if="displayPrefs.homeHero" class="featured-bento featured-bento--skeleton" aria-hidden="true">
        <div class="featured-large skeleton-block"></div>
        <div v-for="n in 4" :key="n" class="featured-small"><div class="skeleton-thumb skeleton-block"></div></div>
      </div>
      <HomeRow
        v-for="id in skeletonRows"
        :key="id"
        :title="rowName(id)"
        :variant="SKELETON_VARIANT[id] ?? 'video'"
        loading
      />
    </div>

    <!-- Home deliberately emptied by the viewer's preferences -->
    <EmptyState
      v-else-if="!searchQuery && homeFullyHidden"
      :title="emptyHomeCopy.title"
      :description="emptyHomeCopy.description"
      icon="video"
      :action-text="auth.isLoggedIn.value ? t('home.openAccount') : undefined"
      action-route="/account"
    />

    <!-- Empty library -->
    <EmptyState
      v-else-if="!heroVideo && feedSections.length === 0 && !searchQuery"
      data-testid="home-empty"
      :title="t('home.emptyTitle')"
      :description="emptyLibraryCopy"
      icon="video"
      :action-text="isAdmin ? t('home.addChannels') : (!auth.isLoggedIn.value ? t('home.logIn') : undefined)"
      :action-route="isAdmin ? '/settings?tab=library&section=videos' : '/login'"
    />

    <!-- Search Mode -->
    <div v-else-if="searchQuery" class="search-results">
      <!-- Channel results -->
      <div v-if="searchedChannels.length > 0" class="search-channels-section">
        <h3 class="row-title">{{ t('home.channelsHeading') }}</h3>
        <div class="channels-row">
          <NuxtLink 
            v-for="channel in searchedChannels.slice(0, 6)" 
            :key="channel.id" 
            :to="`/channels?channelId=${channel.id}`"
            class="search-channel-pill"
          >
            <img :src="channel.avatar_url || fallbackAvatar" @error="handleAvatarError" class="pill-avatar" alt="" />
            <div class="pill-info">
              <span class="pill-name">{{ channel.title }}</span>
              <span class="pill-count">{{ t('video.count', channel.total_count ?? 0) }}</span>
            </div>
          </NuxtLink>
        </div>
      </div>

      <h3 class="row-title">{{ t('home.videosMatching', { query: searchQuery }) }}</h3>
      <div v-if="searchPending && allVideos.length === 0" class="loading-state" data-testid="home-search-loading">
        <div class="spinner"></div>
      </div>
      <p v-else-if="allVideos.length === 0" class="search-empty" data-testid="home-search-empty">
        {{ searchShorts.length > 0 ? t('home.noLongMatch', { query: searchQuery }) : t('home.noMatch', { query: searchQuery }) }}
      </p>
      <div v-else class="video-grid stagger-in" data-testid="home-search-results">
        <VideoCard v-for="video in allVideos" :key="video.id" :video="video" :search-query="searchQuery" @hidden="onVideoHidden" />
      </div>

      <!-- Search Pagination -->
      <div v-if="searchPagination && searchPagination.totalPages > 1" class="pagination">
        <button class="pagination-btn" :disabled="page === 1" @click="changePage(page - 1)">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
          {{ t('home.previous') }}
        </button>
        <span class="pagination-info">{{ t('home.pageOf', { page, total: searchPagination.totalPages }) }}</span>
        <button class="pagination-btn" :disabled="page === searchPagination.totalPages" @click="changePage(page + 1)">
          {{ t('home.next') }}
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>

      <!-- Matching Shorts: their own section after the long videos. -->
      <div v-if="searchShorts.length > 0" class="search-shorts-section" data-testid="home-search-shorts">
        <h3 class="row-title">{{ t('home.shortsMatching', { query: searchQuery }) }}</h3>
        <div class="video-shorts-grid">
          <VideoCard v-for="video in searchShorts" :key="video.id" :video="video" :search-query="searchQuery" @hidden="onVideoHidden" />
        </div>
      </div>
    </div>

    <!-- Home feed: the hero, then each row in the viewer's order -->
    <div v-else class="netflix-feed">

      <!-- Featured Bento Block -->
      <div v-if="heroVideo" class="featured-bento" :class="{ 'featured-bento--solo': featuredSmall.length === 0 }">
        <div class="featured-large" data-testid="home-hero" @click="navigateTo(`/watch/${heroVideo.id}`)">
          <MediaFrame
            class="hero-backdrop"
            kind="video"
            :src="heroVideo.local_thumbnail_path || youtubeThumb(heroVideo.id, 'hero')"
            :fallback="youtubeThumb(heroVideo.id)"
            img-class="hero-bg-img"
            width="1280"
            height="720"
            loading="eager"
            fetchpriority="high"
          />
          <div class="hero-gradient-left"></div>
          <div class="hero-gradient-bottom"></div>
          <div class="hero-content">
            <span v-if="heroVideo.reason?.label" class="hero-reason">{{ reasonLabel(heroVideo) }}</span>
            <div class="hero-channel-badge">
              <img :src="heroVideo.channel_avatar || fallbackAvatar" @error="handleAvatarError" class="hero-channel-img" alt="" />
              <span>{{ heroVideo.channel_title }}</span>
            </div>
            <h1 class="hero-title" :title="heroVideo.original_title || undefined">{{ heroVideo.title }}</h1>
            <div class="hero-meta">
              <span>{{ t('video.views', { views: formatViews(heroVideo.view_count) }) }}</span>
              <span class="meta-dot">•</span>
              <span>{{ formatUploadDate(heroVideo.upload_date) }}</span>
              <span class="meta-dot">•</span>
              <span>{{ formatDuration(heroVideo.duration) }}</span>
            </div>
            <div class="hero-actions">
              <NuxtLink :to="`/watch/${heroVideo.id}`" class="hero-play-btn" @click.stop>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                {{ t('video.play') }}
              </NuxtLink>
            </div>
          </div>
        </div>
        <div v-for="video in featuredSmall" :key="video.id" class="featured-small">
          <VideoCard :video="video" @hidden="onVideoHidden" />
        </div>
      </div>

      <!-- A guest gets the public rows only: say what signing in adds. -->
      <div v-if="!auth.isLoggedIn.value" class="guest-hint" data-testid="home-guest-hint">
        <span>{{ t('home.guestHint') }}</span>
        <NuxtLink to="/login" class="btn btn-sm btn-primary">{{ t('home.logIn') }}</NuxtLink>
      </div>

      <HomeSection
        v-for="section in feedSections"
        :key="section.id"
        :section="section"
        :logged-in="auth.isLoggedIn.value"
        @hidden="onVideoHidden"
      />

    </div>
  </div>
</template>

<script setup lang="ts">
import { setImageFallback } from '~/utils/imageFallback';
import { youtubeThumb } from '~/utils/thumb';
import { formatViewCount } from '~/utils/formatCount';
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';

import { isHomeFullyHidden } from '~/utils/displayPrefs';
import { MEDIA_HOME_SECTION_MODULE, type HomeSectionId } from '#shared/displayPrefs';
import { isGuestHomeSection } from '~/utils/homeSectionLabels';
import { prepareHomeSections } from '~/utils/homeFeed';
import HomeRow from '~/components/home/HomeRow.vue';
import HomeSection from '~/components/home/HomeSection.vue';

const { t, locale } = useI18n();
const { reasonLabel, rowName } = useVideoText();
const auth = useAuth();
const { isAdmin } = auth;
const { effective: displayPrefs } = useDisplayPrefs();
const { enabledModules } = useModules();
const homeFullyHidden = computed(() => isHomeFullyHidden(displayPrefs.value, auth.isLoggedIn.value, enabledModules.value));

// A guest cannot change preferences: the admin hid everything, so say that instead.
const emptyHomeCopy = computed(() => auth.isLoggedIn.value
  ? { title: t('home.hiddenTitle'), description: t('home.hiddenDesc') }
  : { title: t('home.hiddenGuestTitle'), description: t('home.hiddenGuestDesc') });
const route = useRoute();
const router = useRouter();

const searchQuery = computed(() => route.query.q ? String(route.query.q) : '');
useHead({ title: computed(() => (searchQuery.value ? t('home.titleSearch', { query: searchQuery.value }) : t('home.titleHome'))) });
const page = computed(() => route.query.page ? parseInt(String(route.query.page), 10) : 1);

const allVideos = ref<any[]>([]);
const searchPagination = ref<any>(null);

// Both fetches react to ?q= (typing in the header search on "/" and pressing
// Enter only changes the query; clicking the logo from "/?q=..." only drops
// it). Each one is a no-op in the other mode, instead of an `immediate` flag
// frozen at the first render. useRequestFetch forwards the cookies on SSR.
const feedSeed = useFeedSeed();
const requestFetch = useRequestFetch();
const inSearch = computed(() => !!searchQuery.value);

const { data: searchData, pending: searchPending } = await useAsyncData<{ videos: any[]; pagination: any } | null>(
  'home-search',
  () => (searchQuery.value
    ? requestFetch<any>('/api/videos', { params: { page: page.value, limit: 24, q: searchQuery.value, status: 'completed', seed: feedSeed, type: 'video' } })
    : Promise.resolve(null)),
  { watch: [searchQuery, page] }
);

// Matching Shorts (first 12) for the section after the long videos. A
// failure only hides that section.
const { data: searchShortsData } = await useAsyncData<any[]>(
  'home-search-shorts',
  async () => (searchQuery.value
    ? ((await requestFetch<any>('/api/videos', { params: { limit: 12, q: searchQuery.value, status: 'completed', seed: feedSeed, type: 'short' } }).catch(() => null))?.videos || [])
    : []),
  { watch: [searchQuery], default: () => [] }
);
const searchShorts = ref<any[]>([]);
watch(searchShortsData, (list) => { searchShorts.value = list || []; }, { immediate: true });

// Fetch for home feed (featured block + discovery rows)
const { data: homeFeedData, pending: homeFeedPending } = await useAsyncData<{
  featured: { large: any; small: any[] };
  sections: any[];
} | null>(
  'home-feed',
  () => (inSearch.value ? Promise.resolve(null) : requestFetch<any>('/api/home/feed')),
  // lazy: a client-side visit shows the skeleton rows at once instead of
  // waiting on the old page (the server render still waits for the data).
  { watch: [inSearch], lazy: true }
);

// Fetch channels for search
const { data: channelsData } = await useAsyncData<{ channels: any[] } | null>(
  'home-search-channels',
  () => (searchQuery.value ? requestFetch<any>('/api/channels', { params: { search: searchQuery.value } }) : Promise.resolve(null)),
  { watch: [searchQuery] }
);

const searchedChannels = computed(() => {
  if (!searchQuery.value) return [];
  return channelsData.value?.channels || [];
});

watch(searchData, (data) => {
  allVideos.value = data?.videos || [];
  searchPagination.value = data?.pagination || null;
}, { immediate: true });

// The full-page spinner is for the home feed only; a search shows its own.
const loading = computed(() => !inSearch.value && homeFeedPending.value && !homeFeedData.value);

const emptyLibraryCopy = computed(() => (auth.isLoggedIn.value
  ? (isAdmin.value ? t('home.emptyAdmin') : t('home.emptyMember'))
  : t('home.emptyGuest')));

// Videos hidden from this page (the card menu's "Hide"). The feed data is a
// shallow ref, so the rows are filtered through this set instead of mutated.
const hiddenIds = ref<Set<string>>(new Set());
const featuredLarge = computed(() => {
  const large = homeFeedData.value?.featured?.large ?? null;
  return large && !hiddenIds.value.has(large.id) ? large : null;
});
const featuredSmall = computed(() => (homeFeedData.value?.featured?.small ?? []).filter((v: any) => !hiddenIds.value.has(v.id)));
const isGuest = computed(() => !auth.isLoggedIn.value);

// The hero is the feed's featured video; without one (but with the featured
// block on), the first "Recommended for you" video takes its place and leaves
// that row.
const heroFromForYou = computed(() => {
  if (featuredLarge.value || !displayPrefs.value.homeHero || isGuest.value) return null;
  const forYou = (homeFeedData.value?.sections ?? []).find((s: any) => s?.id === 'forYou');
  return forYou?.videos?.find((v: any) => v && !v.is_short && !hiddenIds.value.has(v.id)) ?? null;
});
const heroVideo = computed(() => featuredLarge.value ?? heroFromForYou.value);
const feedSections = computed(() => prepareHomeSections(homeFeedData.value?.sections, {
  guest: isGuest.value,
  heroId: heroFromForYou.value?.id ?? null,
  hidden: hiddenIds.value,
}));

// While the feed loads: one skeleton row per row the viewer will get.
const skeletonRows = computed(() => (displayPrefs.value.homeSections as HomeSectionId[])
  .filter((id) => !isGuest.value || isGuestHomeSection(id))
  .filter((id) => {
    const module = MEDIA_HOME_SECTION_MODULE[id];
    return !module || enabledModules.value.includes(module);
  }));
const SKELETON_VARIANT: Partial<Record<HomeSectionId, 'video' | 'short' | 'playlist' | 'channel' | 'media'>> = {
  shorts: 'short', playlists: 'playlist', discoverChannels: 'channel', recentMusic: 'media', newEpisodes: 'media',
};

const changePage = (newPage: number) => {
  router.push({ path: '/', query: { ...route.query, page: newPage } });
};

const fallbackAvatar = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';

const handleAvatarError = (event: Event) => {
  setImageFallback(event, fallbackAvatar);
};

const onVideoHidden = (id: string) => {
  hiddenIds.value = new Set([...hiddenIds.value, id]);
  allVideos.value = allVideos.value.filter(v => v.id !== id);
  searchShorts.value = searchShorts.value.filter(v => v.id !== id);
};

/* Formatters */
const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatViews = (views: number | null): string => formatViewCount(views, locale.value);

const formatUploadDate = (dateStr: string | null): string => {
  if (!dateStr || dateStr.length !== 8) return '';
  const y = dateStr.slice(0, 4), mo = dateStr.slice(4, 6), d = dateStr.slice(6, 8);
  return new Date(+y, +mo - 1, +d).toLocaleDateString(locale.value, { day: 'numeric', month: 'short', year: 'numeric' });
};
</script>

<style scoped>
.search-shorts-section {
  margin-top: 32px;
}

.search-empty {
  color: var(--text-secondary);
  font-size: 14px;
  padding: 24px 0;
}

/* ===== Container ===== */
.home-container {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* ===== Loading ===== */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  gap: 16px;
  color: var(--text-secondary);
}

.loading-state .spinner {
  width: 36px;
  height: 36px;
  border: 3.5px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* ===== Featured Bento Block ===== */
.featured-bento {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  grid-template-rows: repeat(2, auto);
  gap: 16px;
  margin-bottom: 32px;
  /* Rows size to their content so a wrapped title never clips the channel row. */
  height: auto;
  min-height: 420px;
}

.featured-large {
  grid-row: span 2;
  min-height: 420px;
  position: relative;
  border-radius: var(--border-radius-lg);
  overflow: hidden;
  cursor: pointer;
}

/* The hero is a backdrop sized by the bento grid (not a fixed-ratio card):
   the image is still cropped by the media-frame cover rule, centred, over
   the same placeholder colour while it loads. */
.hero-backdrop {
  position: absolute;
  inset: 0;
  height: 100%;
}

.featured-large :deep(.hero-bg-img) {
  filter: brightness(0.55);
  transition: transform 8s ease, filter 0.5s ease;
}

.featured-large:hover :deep(.hero-bg-img) {
  transform: scale(1.03);
  filter: brightness(0.45);
}

.hero-gradient-left {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(12, 10, 18, 0.95) 0%, rgba(12, 10, 18, 0.6) 40%, transparent 70%);
}

.hero-gradient-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 160px;
  background: linear-gradient(to top, var(--bg-base) 0%, transparent 100%);
}

.hero-content {
  position: absolute;
  bottom: 32px;
  left: 32px;
  max-width: 90%;
  z-index: 2;
}

.hero-channel-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.hero-channel-img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}

.hero-title {
  font-size: 26px;
  font-weight: 800;
  color: white;
  line-height: 1.2;
  margin: 0 0 12px 0;
  letter-spacing: -0.02em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  white-space: nowrap;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 18px;
}

.meta-dot { font-weight: 700; }

.hero-actions {
  display: flex;
  gap: 12px;
}

.hero-reason {
  display: inline-block;
  margin-bottom: 10px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.3);
  color: #e9d5ff;
  font-size: 12px;
  font-weight: 600;
}

.hero-play-btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 28px;
  background: white;
  color: #0c0a12;
  border: none;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hero-play-btn:focus-visible {
  outline: 2px solid white;
  outline-offset: 3px;
}

.hero-play-btn:hover {
  background: rgba(255, 255, 255, 0.85);
  transform: scale(1.03);
}

/* No small cards: the hero takes the whole width. */
.featured-bento--solo {
  grid-template-columns: 1fr;
  min-height: 0;
}
.featured-bento--solo .featured-large { min-height: 360px; }

.featured-small {
  min-height: 0;
  overflow: visible;
}

.featured-small :deep(.video-info) {
  padding-top: 8px;
}

.featured-small :deep(.video-title) {
  margin-bottom: 6px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

@media (max-width: 900px) {
  .featured-bento {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 240px repeat(2, auto);
    height: auto;
    min-height: 0;
  }
  .featured-large {
    grid-row: 1;
    grid-column: 1 / -1;
    height: 240px;
    min-height: 0;
  }
  .hero-content { left: 24px; bottom: 24px; }
  .hero-title { font-size: 20px; }
}

@media (max-width: 640px) {
  .featured-bento {
    grid-template-columns: 1fr;
  }
  .featured-large { height: 220px; }
}

/* Phones: the hero alone (the rows below carry the rest), its text kept
   inside the banner. */
@media (max-width: 480px) {
  .featured-bento { margin-bottom: 24px; grid-template-rows: auto; gap: 0; }
  .featured-small { display: none; }
  .featured-large { height: 210px; }
  .hero-content { left: 16px; right: 16px; bottom: 16px; max-width: none; }
  .hero-channel-badge { margin-bottom: 6px; font-size: 12px; }
  .hero-title { font-size: 18px; margin-bottom: 6px; }
  .hero-meta { font-size: 12px; margin-bottom: 12px; }
  .hero-play-btn { padding: 8px 20px; font-size: 14px; }
}

/* ===== Search result titles ===== */
.row-title {
  font-size: 18px;
  font-weight: 700;
  color: white;
  margin: 0 0 14px 0;
  letter-spacing: -0.01em;
}

/* ===== Guest hint ===== */
.guest-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: -8px 0 28px;
  padding: 12px 16px;
  border-radius: var(--border-radius-md);
  border: 1px solid var(--border-color);
  background: rgba(139, 92, 246, 0.07);
  font-size: 13.5px;
  color: var(--text-secondary);
}

/* ===== Loading skeleton ===== */
.skeleton-block {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.04) 25%, rgba(255, 255, 255, 0.09) 37%, rgba(255, 255, 255, 0.04) 63%);
  background-size: 400% 100%;
  animation: home-skeleton-pulse 1.6s ease-in-out infinite;
}
.featured-bento--skeleton .featured-large { cursor: default; }
.skeleton-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
}
@keyframes home-skeleton-pulse {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton-block { animation: none; }
}

/* ===== Search Grid ===== */
.search-results {
  display: flex;
  flex-direction: column;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(max(1, calc(4 + var(--grid-offset, 0))), 1fr);
  gap: 20px;
  margin-bottom: 32px;
}

@media (max-width: 1400px) {
  .video-grid { grid-template-columns: repeat(max(1, calc(3 + var(--grid-offset, 0))), 1fr); }
}

@media (max-width: 1000px) {
  .video-grid { grid-template-columns: repeat(max(1, calc(2 + var(--grid-offset, 0))), 1fr); }
}

@media (max-width: 640px) {
  .video-grid { grid-template-columns: 1fr; }
}

/* ===== Search Channels ===== */
.search-channels-section {
  margin-bottom: 24px;
}

.channels-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.search-channel-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px 8px 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 40px;
  text-decoration: none;
  transition: all 0.2s ease;
}

.search-channel-pill:hover {
  background: rgba(139, 92, 246, 0.1);
  border-color: rgba(139, 92, 246, 0.3);
}

.pill-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.pill-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pill-name {
  font-size: 13px;
  font-weight: 600;
  color: white;
}

.pill-count {
  font-size: 11px;
  color: var(--text-secondary);
}

/* ===== Pagination ===== */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px 0;
}

.pagination-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.pagination-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: white;
  border-color: rgba(139, 92, 246, 0.3);
}

.pagination-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pagination-info {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

</style>
