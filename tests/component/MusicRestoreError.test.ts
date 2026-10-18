import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import MusicMiniPlayer from '../../app/components/MusicMiniPlayer.vue';
import { useMusicPlayer } from '../../app/composables/useMusicPlayer';
import { useToast } from '../../app/composables/useToast';

const saved = { trackId: 't1', queueTrackIds: ['t1', 't2'], currentIndex: 0, currentTime: 12, shuffleOn: false, repeatMode: 'off', lastPlayedAt: 1 };

beforeEach(() => {
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('music_player_current_track').value = null;
  useState('music_player_queue').value = [];
  useState('music_player_current_index').value = -1;
  useState('music_player_restoring').value = false;
  useToast().toasts.value = [];
  window.localStorage.setItem('music_player_state', JSON.stringify(saved));
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url === '/api/music/tracks/by-ids') {
      return { tracks: [{ id: 't1', title: 'Gone', local_file_path: '/downloads-music/gone.mp3' }, { id: 't2', title: 'Two', local_file_path: '/downloads-music/two.mp3' }] };
    }
    return {};
  }));
});
afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const mountPlayer = async () => {
  const w = await mountSuspended(MusicMiniPlayer);
  await flushPromises();
  return w;
};

describe('music mini-player restore', () => {
  it('clears a stale restored track silently when it fails to load', async () => {
    const w = await mountPlayer();
    const audio = w.find('video').element as HTMLVideoElement;
    expect(useState<any>('music_player_current_track').value?.id).toBe('t1');
    audio.dispatchEvent(new Event('error'));
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).not.toContain('Error playing audio.');
    expect(window.localStorage.getItem('music_player_state')).toBeNull();
    expect(useState<any>('music_player_current_track').value).toBeNull();
    expect(useState<any>('music_player_queue').value).toEqual([]);
  });

  it('still reports an error on a track the user started', async () => {
    const w = await mountPlayer();
    const audio = w.find('video').element as HTMLVideoElement;
    audio.play = vi.fn(async () => undefined) as any;
    const holder: { p?: ReturnType<typeof useMusicPlayer> } = {};
    holder.p = useMusicPlayer();
    holder.p.togglePlay();
    audio.dispatchEvent(new Event('error'));
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Error playing audio.');
    expect(window.localStorage.getItem('music_player_state')).not.toBeNull();
  });

  it('never records a play for a restored, paused track (#10)', async () => {
    window.localStorage.setItem('music_player_state', JSON.stringify({ ...saved, currentTime: 95 }));
    const w = await mountPlayer();
    const audio = w.find('video').element as HTMLVideoElement;
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    Object.defineProperty(audio, 'paused', { value: true, configurable: true });
    audio.dispatchEvent(new Event('loadedmetadata'));
    audio.currentTime = 95;
    audio.dispatchEvent(new Event('timeupdate'));
    await flushPromises();
    const plays = () => (globalThis as any).$fetch.mock.calls.filter(([u]: [string]) => u.endsWith('/play'));
    expect(plays()).toHaveLength(0);

    // Once the user presses play, the usual threshold applies.
    Object.defineProperty(audio, 'paused', { value: false, configurable: true });
    audio.play = vi.fn(async () => undefined) as any;
    useMusicPlayer().togglePlay();
    await flushPromises();
    audio.dispatchEvent(new Event('play'));
    audio.dispatchEvent(new Event('timeupdate'));
    await flushPromises();
    expect(plays()).toHaveLength(1);
    expect(plays()[0][0]).toBe('/api/music/tracks/t1/play');
  });
});
