import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref, nextTick } from 'vue';
import { useVideoWatchProgress } from '../../app/composables/useVideoWatchProgress';
import { getResumePosition, saveResumePosition, parseStartTime, resumeTarget, VIDEO_RESUME_KEY } from '../../app/utils/videoResume';

// #20: watch time from the regular watch page, and resume position.
let fetchMock: ReturnType<typeof vi.fn>;

function fakeVideo(duration = 1000) {
  const el = document.createElement('video');
  let paused = true;
  let time = 0;
  Object.defineProperty(el, 'paused', { configurable: true, get: () => paused });
  Object.defineProperty(el, 'duration', { configurable: true, get: () => duration });
  Object.defineProperty(el, 'currentTime', { configurable: true, get: () => time, set: (v: number) => { time = v; } });
  return {
    el,
    play() { paused = false; el.dispatchEvent(new Event('play')); },
    pause() { paused = true; el.dispatchEvent(new Event('pause')); },
    // Plays `seconds` of video in 250 ms steps, as a browser fires timeupdate.
    async advance(seconds: number) {
      for (let i = 0; i < seconds * 4; i++) {
        await vi.advanceTimersByTimeAsync(250);
        time += 0.25;
        el.dispatchEvent(new Event('timeupdate'));
      }
    },
  };
}

function host(video: ReturnType<typeof fakeVideo>, opts: { id?: string; loggedIn?: boolean; startAt?: number | null } = {}) {
  const videoId = ref(opts.id ?? 'v1');
  const isLoggedIn = ref(opts.loggedIn ?? true);
  const startAt = ref(opts.startAt ?? null);
  const Host = defineComponent({
    setup() {
      useVideoWatchProgress({ videoEl: () => video.el, videoId, isLoggedIn, startAt });
      return () => h('div');
    },
  });
  return { wrapper: mount(Host), videoId };
}

const trackCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/videos/track').map(([, o]) => o.body);

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.removeItem(VIDEO_RESUME_KEY);
  fetchMock = vi.fn(async () => ({ success: true }));
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('watch time tracking', () => {
  it('posts every 15 s of actual playback and the rest on pause', async () => {
    const v = fakeVideo();
    const { wrapper } = host(v);
    await nextTick();
    v.play();
    await v.advance(31);
    expect(trackCalls()).toEqual([{ videoId: 'v1', watchTimeSeconds: 15 }, { videoId: 'v1', watchTimeSeconds: 15 }]);
    v.pause();
    expect(trackCalls()).toHaveLength(3);
    expect(trackCalls()[2]!.watchTimeSeconds).toBe(1);
    // Paused time is not watch time.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(trackCalls()).toHaveLength(3);
    wrapper.unmount();
  });

  it('never posts for a guest', async () => {
    const v = fakeVideo();
    const { wrapper } = host(v, { loggedIn: false });
    await nextTick();
    v.play();
    await v.advance(20);
    v.pause();
    wrapper.unmount();
    expect(trackCalls()).toHaveLength(0);
  });

  it('sends what is left when leaving the page', async () => {
    const v = fakeVideo();
    const { wrapper } = host(v);
    await nextTick();
    v.play();
    await v.advance(7);
    wrapper.unmount();
    expect(trackCalls()).toEqual([{ videoId: 'v1', watchTimeSeconds: 7 }]);
  });
});

describe('resume position', () => {
  it('resumes where the video was left, but not with ?t= and not once watched', async () => {
    saveResumePosition('v1', 321, 1000);
    const v = fakeVideo();
    host(v);
    await nextTick();
    expect(v.el.currentTime).toBe(321);

    const v2 = fakeVideo();
    host(v2, { startAt: 42 });
    await nextTick();
    expect(v2.el.currentTime).toBe(42);

    saveResumePosition('v1', 960, 1000);
    expect(getResumePosition('v1')).toBeNull();
  });

  it('saves the position while playing', async () => {
    const v = fakeVideo();
    const { wrapper } = host(v, { loggedIn: false });
    await nextTick();
    v.play();
    await v.advance(12);
    v.pause();
    expect(getResumePosition('v1')).toBe(12);
    wrapper.unmount();
  });
});

describe('helpers', () => {
  it('parses ?t= values', () => {
    expect(parseStartTime('90')).toBe(90);
    expect(parseStartTime('1m30s')).toBe(90);
    expect(parseStartTime('1h')).toBe(3600);
    expect(parseStartTime('x')).toBeNull();
    expect(parseStartTime(undefined)).toBeNull();
  });
  it('only resumes between 5 s and 95 %', () => {
    expect(resumeTarget(3, 100)).toBeNull();
    expect(resumeTarget(96, 100)).toBeNull();
    expect(resumeTarget(50, 100)).toBe(50);
  });
});
