import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import VideoPlayer from '../../app/components/VideoPlayer.vue';

let hidden = false;
let now = 1_000_000;

beforeEach(() => {
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (document as any).hidden;
});

const video = { id: 'v1', title: 'T', local_video_path: '/downloads/v1.mp4', duration: 100 };

async function mountPlayer(props: Record<string, unknown> = {}) {
  const w = await mountSuspended(VideoPlayer, { props: { video, subtitles: [{ code: 'en', label: 'English', url: '/downloads/v1.en.vtt' }], ...props } });
  const el = w.find('video').element as HTMLVideoElement;
  let paused = false;
  Object.defineProperty(el, 'paused', { configurable: true, get: () => paused });
  const play = vi.fn(async () => { paused = false; });
  el.play = play as any;
  return { w, el, play, setPaused: (p: boolean) => { paused = p; } };
}

const setVisibility = (isHidden: boolean) => {
  hidden = isHidden;
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('VideoPlayer', () => {
  it('encodes the share token in the video and subtitle URLs', async () => {
    const { w } = await mountPlayer({ token: 'a&b=c d' });
    expect(w.find('video').attributes('src')).toBe('/downloads/v1.mp4?token=a%26b%3Dc%20d');
    expect(w.find('track').attributes('src')).toBe('/downloads/v1.en.vtt?token=a%26b%3Dc%20d');
  });

  it('resumes on tab return after the browser paused background playback', async () => {
    const { el, play, setPaused } = await mountPlayer();
    setVisibility(true);
    now += 100;
    setPaused(true);
    el.dispatchEvent(new Event('pause'));
    play.mockClear();
    now += 60_000;
    setVisibility(false);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not resume on tab return if the user paused it (media keys) while hidden', async () => {
    const { el, play, setPaused } = await mountPlayer();
    setVisibility(true);
    now += 30_000;
    setPaused(true);
    el.dispatchEvent(new Event('pause'));
    play.mockClear();
    now += 30_000;
    setVisibility(false);
    expect(play).not.toHaveBeenCalled();
  });
});
