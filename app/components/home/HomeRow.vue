<template>
  <section class="home-row" :data-testid="testid" :aria-labelledby="headingId" :aria-busy="loading ? 'true' : undefined">
    <div class="home-row__header">
      <h2 :id="headingId" class="home-row__title">
        <template v-if="loading && !title"><UiSkeleton width="180px" height="20px" /></template>
        <template v-else>{{ title }}</template>
      </h2>
      <div class="home-row__tools">
        <!-- Arrows for mouse and keyboard users; touch screens swipe instead
             (hidden there by the hover media query). They keep their place
             while idle and sit left of "See all", so nothing moves when they
             appear. -->
        <span class="home-row__arrows" :class="{ 'is-idle': !overflowing }">
          <button
            type="button"
            class="home-row__arrow"
            data-testid="row-prev"
            :aria-label="t('home.scrollBack', { title: title || t('home.row') })"
            :disabled="!canPrev"
            @click="page(-1)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button
            type="button"
            class="home-row__arrow"
            data-testid="row-next"
            :aria-label="t('home.scrollForward', { title: title || t('home.row') })"
            :disabled="!canNext"
            @click="page(1)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </span>
        <NuxtLink v-if="seeAll && !loading" :to="seeAll" class="home-row__see-all" data-testid="row-see-all">{{ seeAllText }}</NuxtLink>
      </div>
    </div>
    <div ref="track" class="home-row__track" :class="`home-row__track--${variant}`" @scroll.passive="update">
      <template v-if="loading">
        <div v-for="n in skeletonCount" :key="n" class="row-item home-row__skeleton" data-testid="row-skeleton" aria-hidden="true">
          <div class="home-row__skeleton-media"></div>
          <template v-if="variant !== 'channel'">
            <UiSkeleton height="14px" width="85%" />
            <UiSkeleton height="12px" width="55%" />
          </template>
        </div>
      </template>
      <slot v-else />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';

// One titled, horizontally scrolling row of the home page. The items are the
// slot's `.row-item` children, sized by `variant` (16:9 video cards, 9:16
// Shorts, playlist covers, channel cards, music/podcast tiles). While
// `loading`, skeleton tiles of the same size hold the row's place.
const props = withDefaults(defineProps<{
  title?: string;
  seeAll?: string | null;
  seeAllLabel?: string;
  variant?: 'video' | 'short' | 'playlist' | 'channel' | 'media';
  loading?: boolean;
  skeletonCount?: number;
  testid?: string;
}>(), {
  title: '',
  seeAll: null,
  seeAllLabel: '',
  variant: 'video',
  loading: false,
  skeletonCount: 6,
  testid: undefined,
});

// useId: the same id in the server render and after hydration.
const { t } = useI18n();
const seeAllText = computed(() => props.seeAllLabel || t('home.seeAll'));
const headingId = `home-row-${useId()}`;
const track = ref<HTMLElement | null>(null);
const canPrev = ref(false);
const canNext = ref(false);
const overflowing = ref(false);

function update() {
  const el = track.value;
  if (!el) return;
  const max = el.scrollWidth - el.clientWidth;
  overflowing.value = max > 1;
  canPrev.value = el.scrollLeft > 1;
  canNext.value = el.scrollLeft < max - 1;
}

/** Scrolls by most of a screen of the row, so one item stays in sight. */
function page(direction: -1 | 1) {
  const el = track.value;
  if (!el) return;
  const step = Math.max(200, Math.round(el.clientWidth * 0.85));
  el.scrollBy({ left: direction * step, behavior: 'smooth' });
}

let resize: ResizeObserver | null = null;
onMounted(() => {
  update();
  if (typeof ResizeObserver !== 'undefined' && track.value) {
    resize = new ResizeObserver(update);
    resize.observe(track.value);
  }
});
onBeforeUnmount(() => resize?.disconnect());
watch(() => props.loading, () => nextTick(update));

defineExpose({ update, page });
</script>

<style scoped>
.home-row {
  margin-bottom: 30px;
  min-width: 0;
}

.home-row__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
  margin-bottom: 12px;
}

.home-row__title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.01em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-row__tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.home-row__see-all {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-primary-hover);
  text-decoration: none;
  white-space: nowrap;
  padding: 4px 2px;
  border-radius: 4px;
}
.home-row__see-all:hover { color: var(--text-primary); }
.home-row__see-all:focus-visible,
.home-row__arrow:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.home-row__arrows {
  display: inline-flex;
  gap: 6px;
}
.home-row__arrows.is-idle { visibility: hidden; }

.home-row__arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), opacity var(--duration-fast);
}
.home-row__arrow:hover:not(:disabled) { background: var(--bg-surface-hover); }
.home-row__arrow:disabled { opacity: 0.3; cursor: default; }

@media (hover: none), (pointer: coarse) {
  .home-row__arrows { display: none; }
}

.home-row__track {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  overflow-y: hidden;
  /* Room for the card hover lift and focus rings, without moving the cards. */
  padding: 4px 2px 10px;
  margin: -4px -2px 0;
  scroll-snap-type: x proximity;
  scroll-padding-left: 2px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.home-row__track::-webkit-scrollbar { display: none; }

.home-row__track > :deep(.row-item),
.home-row__track > .row-item {
  flex: 0 0 var(--row-item-width);
  width: var(--row-item-width);
  min-width: 0;
  scroll-snap-align: start;
}

.home-row__track--video { --row-item-width: calc(264px * var(--grid-min-scale, 1)); }
.home-row__track--short { --row-item-width: calc(168px * var(--grid-min-scale, 1)); }
.home-row__track--playlist { --row-item-width: calc(240px * var(--grid-min-scale, 1)); }
.home-row__track--channel { --row-item-width: calc(200px * var(--grid-min-scale, 1)); }
.home-row__track--media { --row-item-width: calc(180px * var(--grid-min-scale, 1)); }

@media (max-width: 900px) {
  .home-row__track--video { --row-item-width: calc(232px * var(--grid-min-scale, 1)); }
  .home-row__track--playlist { --row-item-width: calc(210px * var(--grid-min-scale, 1)); }
  .home-row__track--media { --row-item-width: calc(150px * var(--grid-min-scale, 1)); }
}

@media (max-width: 480px) {
  .home-row__title { font-size: 16px; }
  .home-row__track { gap: 12px; }
  /* Most of the row's width (not the screen's: the sidebar takes some),
     with the next card peeking in. */
  .home-row__track--video { --row-item-width: 86%; }
  .home-row__track--playlist { --row-item-width: 72%; }
  .home-row__track--short { --row-item-width: 44%; }
  .home-row__track--channel { --row-item-width: 52%; }
  .home-row__track--media { --row-item-width: 44%; }
}

/* Skeleton tiles: the same box as the real item, so nothing shifts. */
.home-row__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.home-row__skeleton-media {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  margin-bottom: 4px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.04) 25%, rgba(255, 255, 255, 0.09) 37%, rgba(255, 255, 255, 0.04) 63%);
  background-size: 400% 100%;
  animation: home-row-pulse 1.6s ease-in-out infinite;
}
.home-row__track--short .home-row__skeleton-media { aspect-ratio: 9 / 16; }
.home-row__track--media .home-row__skeleton-media { aspect-ratio: 1; }
.home-row__track--channel .home-row__skeleton-media { aspect-ratio: 4 / 5; }

@keyframes home-row-pulse {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
@media (prefers-reduced-motion: reduce) {
  .home-row__skeleton-media { animation: none; }
}
</style>
