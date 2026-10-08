<template>
  <div class="discover-page">
    <h1 class="page-title discover-title">Discover</h1>

    <div v-if="!loaded" class="discover-status">Loading...</div>

    <template v-else>
      <section v-if="languages.length > 0" class="discover-languages" aria-label="Browse by language">
        <h2 class="discover-languages-title">Browse by language</h2>
        <PodcastLanguageChips :languages="languages" :model-value="language" @update:model-value="setLanguage" />
        <p v-if="language && !filtering && popular.length === 0 && recent.length === 0" class="discover-status">
          No shows in this language yet.
        </p>
      </section>

      <DiscoverRow v-if="popular.length > 0" title="Popular with listeners">
        <PodcastShowCard
          v-for="s in popular"
          :key="s.id"
          :show="s"
          :detail="s.followerCount === 1 ? '1 follower' : `${s.followerCount} followers`"
        />
      </DiscoverRow>

      <DiscoverRow v-if="recent.length > 0" title="Recently updated">
        <PodcastShowCard
          v-for="s in recent"
          :key="s.id"
          :show="s"
          :detail="latestLine(s)"
        />
      </DiscoverRow>

      <DiscoverRow v-if="trending.length > 0" title="Trending episodes" layout="list">
        <PodcastEpisodeRow
          v-for="ep in trending"
          :key="ep.id"
          :episode="ep"
          :context="`${ep.show_title} · ${ep.listenerCount === 1 ? '1 listener' : `${ep.listenerCount} listeners`}`"
          @play="playEpisode"
        />
      </DiscoverRow>

      <DiscoverRow
        v-if="user && because.basedOn && because.shows.length > 0"
        :title="`Because you follow ${because.basedOn.title}`"
      >
        <PodcastShowCard v-for="s in because.shows" :key="s.id" :show="s" />
      </DiscoverRow>

      <EmptyState
        v-if="isEmpty"
        icon="music"
        title="Nothing to discover yet"
        description="Shows appear here once episodes are downloaded and followed."
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { usePodcastDiscover } from '~/composables/usePodcastDiscover';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { toPlayableEpisode } from '~/utils/playableEpisode';

// Podcasts Discover: popular and recently updated shows (filterable by
// language), trending episodes, and suggestions based on the logged-in
// user's follows. Empty rows are left out.
const { user } = useAuth();
const { play } = usePodcastPlayer();
const { popular, recent, trending, because, languages, language, loaded, filtering, load, setLanguage } = usePodcastDiscover();

const isEmpty = computed(() =>
  languages.value.length === 0 && popular.value.length === 0 && recent.value.length === 0
  && trending.value.length === 0 && because.value.shows.length === 0
);

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function latestLine(show: any): string {
  const date = formatDate(show.latestEpisodeAt);
  return date ? `${show.latestEpisodeTitle} · ${date}` : show.latestEpisodeTitle;
}

function playEpisode(ep: any) {
  const playable = toPlayableEpisode(ep);
  if (playable) play(playable);
}

onMounted(load);
</script>

<style scoped>
.discover-title { margin-bottom: 20px; }

.discover-languages { margin-bottom: 28px; }

.discover-languages-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 12px;
}

.discover-status {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
}
</style>
