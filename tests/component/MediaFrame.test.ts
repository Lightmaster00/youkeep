import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { nextTick } from 'vue';
import MediaFrame from '../../app/components/MediaFrame.vue';
import VideoCard from '../../app/components/VideoCard.vue';
import { useVideoPreview } from '../../app/composables/useVideoPreview';

beforeEach(() => {
  vi.stubGlobal('$fetch', vi.fn(async () => ({})));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useVideoPreview().activePreviewId.value = null;
});

describe('MediaFrame', () => {
  it.each([
    ['video', ['480', '270']],
    ['short', ['270', '480']],
    ['square', ['320', '320']],
  ] as const)('a %s frame has its ratio class and matching intrinsic size', async (kind, size) => {
    const w = await mountSuspended(MediaFrame, { props: { kind, src: '/a.jpg' } });
    expect(w.find('.media-frame').classes()).toEqual(expect.arrayContaining(['media-frame', `media-frame--${kind}`]));
    const img = w.find('img.media-frame__media');
    expect([img.attributes('width'), img.attributes('height')]).toEqual([...size]);
    expect(img.attributes('loading')).toBe('lazy');
    expect(img.attributes('decoding')).toBe('async');
  });

  it('defaults to a 16:9 video frame', async () => {
    const w = await mountSuspended(MediaFrame, { props: { src: '/a.jpg' } });
    expect(w.find('.media-frame').classes()).toContain('media-frame--video');
  });

  it('tries the fallback once, then keeps the placeholder instead of a broken image', async () => {
    const w = await mountSuspended(MediaFrame, { props: { src: '/missing.jpg', fallback: 'https://x/fallback.jpg' } });
    const img = w.find('img');
    await img.trigger('error');
    expect(img.attributes('src')).toBe('https://x/fallback.jpg');
    expect((img.element as HTMLImageElement).style.display).toBe('');
    await img.trigger('error');
    await nextTick();
    expect(img.attributes('src')).toBe('https://x/fallback.jpg');
    expect((img.element as HTMLImageElement).style.display).toBe('none');
  });

  it('renders the slot (badges, menus) inside the frame', async () => {
    const w = await mountSuspended(MediaFrame, { props: { src: '/a.jpg' }, slots: { default: () => 'BADGE' } });
    expect(w.text()).toContain('BADGE');
  });
});

const base = { id: 'v1', title: 'T', duration: 100, view_count: 1, upload_date: null, local_video_path: '/downloads/c/v1.mp4' };

describe('VideoCard framing', () => {
  it('a long video sits in a 16:9 frame with no SHORT badge', async () => {
    const w = await mountSuspended(VideoCard, { props: { video: { ...base, is_short: 0 } } });
    const frame = w.find('.thumbnail-wrapper');
    expect(frame.classes()).toEqual(expect.arrayContaining(['media-frame', 'media-frame--video']));
    expect(w.find('.thumbnail-img').classes()).toContain('media-frame__media');
    expect(w.find('[data-testid="short-badge"]').exists()).toBe(false);
    expect(w.find('.video-card').classes()).not.toContain('video-card--short');
  });

  it('a Short is a vertical 9:16 card with a visible SHORT badge', async () => {
    const w = await mountSuspended(VideoCard, { props: { video: { ...base, is_short: 1 } } });
    expect(w.find('.thumbnail-wrapper').classes()).toContain('media-frame--short');
    expect(w.find('.video-card').classes()).toContain('video-card--short');
    expect(w.find('[data-testid="short-badge"]').text()).toBe('SHORT');
    const img = w.find('.thumbnail-img');
    expect([img.attributes('width'), img.attributes('height')]).toEqual(['270', '480']);
  });

  it('falls back to the 16:9 mqdefault YouTube thumbnail without a local one', async () => {
    const w = await mountSuspended(VideoCard, { props: { video: { ...base, id: 'yt1' } } });
    expect(w.find('.thumbnail-img').attributes('src')).toBe('https://i.ytimg.com/vi/yt1/mqdefault.jpg');
  });

  it('falls back from a broken local thumbnail to mqdefault', async () => {
    const w = await mountSuspended(VideoCard, { props: { video: { ...base, id: 'yt2', local_thumbnail_path: '/downloads/c/x.jpg' } } });
    const img = w.find('.thumbnail-img');
    await img.trigger('error');
    expect(img.attributes('src')).toBe('https://i.ytimg.com/vi/yt2/mqdefault.jpg');
  });
});

describe('VideoCard hover preview', () => {
  // Only the timers are faked: a faked Date would make Vue drop later DOM
  // events (its listeners ignore events stamped before they were attached).
  async function hoverToPreview(video: any = base) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = await mountSuspended(VideoCard, { props: { video } });
    await w.find('.video-card').trigger('mouseenter');
    vi.advanceTimersByTime(600);
    await nextTick();
    vi.useRealTimers();
    return w;
  }

  it('plays inside the same frame, cropped with the cover rule, poster kept until the first frame', async () => {
    const w = await hoverToPreview({ ...base, local_thumbnail_path: '/downloads/c/v1.jpg' });
    const video = w.find('.thumbnail-wrapper video');
    expect(video.exists()).toBe(true);
    expect(video.classes()).toEqual(expect.arrayContaining(['media-frame__media', 'media-frame__preview']));
    expect(video.attributes('poster')).toBe('/downloads/c/v1.jpg?w=480');
    // Not shown (thumbnail visible underneath) until it actually plays.
    expect(video.classes()).not.toContain('is-playing');
    expect(w.find('.preview-badge').exists()).toBe(false);
    await video.trigger('playing');
    expect(w.find('.thumbnail-wrapper video').classes()).toContain('is-playing');
    expect(w.find('.preview-badge').exists()).toBe(true);
  });

  it('gives up on a preview that fails to load and keeps the thumbnail', async () => {
    const w = await hoverToPreview();
    const video = w.find('.thumbnail-wrapper video');
    await video.trigger('error');
    expect(w.find('.thumbnail-wrapper video').exists()).toBe(false);
    expect(w.find('.thumbnail-img').isVisible()).toBe(true);
    // Hovering again does not retry a file that is known to fail.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await w.find('.video-card').trigger('mouseleave');
    await w.find('.video-card').trigger('mouseenter');
    vi.advanceTimersByTime(600);
    await nextTick();
    vi.useRealTimers();
    expect(w.find('.thumbnail-wrapper video').exists()).toBe(false);
  });
});
