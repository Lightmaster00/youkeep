import { describe, it, expect, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { defineComponent, h } from 'vue';

// Renders the real catalogue message `video.count` through the wired plural rules.
const Probe = defineComponent({
  props: { n: { type: Number, required: true }, k: { type: String, default: 'video.count' } },
  setup(props) {
    const { t } = useI18n();
    return () => h('span', t(props.k, props.n));
  }
});

afterEach(async () => { await useNuxtApp().$i18n.setLocale('en'); });

describe('plural messages per script family (video.count)', () => {
  it.each([
    ['ru', 0, '0 видео'], ['ru', 1, '1 видео'], ['ru', 2, '2 видео'], ['ru', 5, '5 видео'], ['ru', 21, '21 видео'],
    ['zh', 0, '0 个视频'], ['zh', 1, '1 个视频'], ['zh', 5, '5 个视频'],
    ['ja', 0, '0本の動画'], ['ja', 1, '1本の動画'], ['ja', 5, '5本の動画'],
    ['pt', 0, '0 vídeo'], ['pt', 1, '1 vídeo'], ['pt', 2, '2 vídeos'],
  ] as const)('%s %i -> %s', async (lang, n, expected) => {
    await useNuxtApp().$i18n.setLocale(lang);
    const w = await mountSuspended(Probe, { props: { n } });
    expect(w.text()).toBe(expected);
    w.unmount();
  });
});

describe('Russian one / few / many (watch.comments)', () => {
  it.each([
    [1, '1 комментарий'], [2, '2 комментария'], [5, '5 комментариев'], [11, '11 комментариев'],
    [21, '21 комментарий'], [22, '22 комментария'], [111, '111 комментариев'],
  ] as const)('%i -> %s', async (n, expected) => {
    await useNuxtApp().$i18n.setLocale('ru');
    const w = await mountSuspended(Probe, { props: { n, k: 'watch.comments' } });
    expect(w.text()).toBe(expected);
    w.unmount();
  });
});
