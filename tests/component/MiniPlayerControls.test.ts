import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import MusicMiniPlayer from '../../app/components/MusicMiniPlayer.vue';
import PodcastMiniPlayer from '../../app/components/PodcastMiniPlayer.vue';

// #16: phones keep every control (music: a "More" sheet; podcast: all
// buttons), and both seek bars are real sliders.
beforeEach(() => {
  window.localStorage.clear();
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('active_mini_player_type').value = null;
  useState('music_player_current_track').value = { id: 't1', title: 'Song', artist_name: 'Band', local_file_path: '/m/t1.mp3', has_clip: 1 };
  useState('music_player_queue').value = [];
  useState('podcast_player_current_episode').value = null;
  vi.stubGlobal('$fetch', vi.fn(async () => ({})));
});
afterEach(() => {
  useState('music_player_current_track').value = null;
  useState('podcast_player_current_episode').value = null;
  vi.unstubAllGlobals();
});

describe('music mini player', () => {
  it('has a slider seek bar and a More sheet with the extra controls', async () => {
    const w = await mountSuspended(MusicMiniPlayer);
    await flushPromises();
    const audio = w.find('video').element as HTMLVideoElement;
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    audio.dispatchEvent(new Event('loadedmetadata'));
    await flushPromises();
    const seek = w.find('[data-testid="music-seek"]');
    expect(seek.element.tagName).toBe('INPUT');
    expect(seek.attributes('type')).toBe('range');
    expect(seek.attributes('aria-label')).toBe('Seek');
    expect(seek.attributes('max')).toBe('200');
    await seek.setValue('120');
    expect(audio.currentTime).toBe(120);

    const more = w.find('[data-testid="music-more-btn"]');
    expect(more.attributes('aria-expanded')).toBe('false');
    await more.trigger('click');
    expect(more.attributes('aria-expanded')).toBe('true');
    const sheet = w.find('[data-testid="music-more"]');
    expect(sheet.classes()).toContain('is-open');
    const labels = sheet.findAll('button').map((b) => b.attributes('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['Shuffle', 'Start a radio', 'Watch the clip']));
    expect(labels.some((l) => l?.startsWith('Repeat'))).toBe(true);
    expect(sheet.find('input[aria-label="Volume"]').exists()).toBe(true);
    expect(sheet.text() + sheet.html()).toMatch(/playlist/i);
    w.unmount();
  });
});

describe('podcast mini player', () => {
  it('keeps back 15 s, forward 30 s and speed, with a slider seek bar', async () => {
    useState('music_player_current_track').value = null;
    useState('podcast_player_current_episode').value = { id: 'e1', title: 'Episode', show_title: 'Show', duration: 600, local_file_path: '/p/e1.mp3' };
    const w = await mountSuspended(PodcastMiniPlayer);
    await flushPromises();
    expect(w.find('button[aria-label="Back 15 seconds"]').exists()).toBe(true);
    expect(w.find('button[aria-label="Forward 30 seconds"]').exists()).toBe(true);
    expect(w.find('select[aria-label="Playback speed"]').exists()).toBe(true);
    const seek = w.find('[data-testid="podcast-seek"]');
    expect(seek.attributes('type')).toBe('range');
    expect(seek.attributes('aria-valuetext')).toContain('of');
    w.unmount();
  });
});
