<template>
  <!-- The one box every thumbnail sits in (see .media-frame in main.css): a
       fixed aspect ratio, the image cropped to it with object-fit: cover, a
       neutral placeholder until it loads, and nothing ever spilling out.
       Overlays (badges, menus, a hover preview) go in the default slot. -->
  <div class="media-frame" :class="`media-frame--${kind}`" :data-frame="kind">
    <img
      v-if="src"
      v-show="!failed"
      :src="src"
      :alt="alt"
      :width="width ?? DEFAULT_SIZE[kind][0]"
      :height="height ?? DEFAULT_SIZE[kind][1]"
      :loading="loading"
      :fetchpriority="fetchpriority"
      decoding="async"
      referrerpolicy="no-referrer"
      class="media-frame__media"
      :class="imgClass"
      @error="onError"
    />
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { setImageFallback } from '~/utils/imageFallback';

export type MediaFrameKind = 'video' | 'short' | 'square';

const props = withDefaults(defineProps<{
  kind?: MediaFrameKind;
  src?: string | null;
  /** Tried once when `src` fails to load; when it fails too, the placeholder stays. */
  fallback?: string | null;
  alt?: string;
  width?: number | string;
  height?: number | string;
  loading?: 'lazy' | 'eager';
  fetchpriority?: 'high' | 'low' | 'auto';
  imgClass?: string | string[] | Record<string, boolean>;
}>(), {
  kind: 'video',
  src: '',
  fallback: '',
  alt: '',
  loading: 'lazy',
  fetchpriority: undefined,
  imgClass: undefined,
});

// Intrinsic size attributes (the ratio the browser reserves before the image
// arrives), matching each frame's aspect ratio.
const DEFAULT_SIZE: Record<MediaFrameKind, [number, number]> = {
  video: [480, 270],
  short: [270, 480],
  square: [320, 320],
};

const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });

function onError(event: Event) {
  const img = event.target as HTMLImageElement | null;
  const current = img?.getAttribute('src');
  // No fallback, or the fallback failed as well: show the placeholder
  // instead of a broken-image icon.
  if (!props.fallback || current === props.fallback || img?.dataset.fallbackSrc === current) {
    failed.value = true;
    return;
  }
  setImageFallback(event, props.fallback);
}
</script>
