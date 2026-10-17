import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { defineComponent, h } from 'vue';
import { useAuth } from '../../app/composables/useAuth';
import { USER_LOCAL_STORAGE_KEYS } from '../../app/utils/userClientState';

async function setupAuth() {
  const holder: { auth?: ReturnType<typeof useAuth> } = {};
  const Host = defineComponent({
    setup() {
      holder.auth = useAuth();
      return () => h('div');
    },
  });
  await mountSuspended(Host);
  return holder.auth!;
}

function fakeAudio() {
  return { pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() } as any;
}

let cacheStore: string[];

beforeEach(() => {
  useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
  for (const key of USER_LOCAL_STORAGE_KEYS) window.localStorage.setItem(key, '{"x":1}');
  window.localStorage.setItem('youkeep:sidebar-panel', '"music"');
  window.localStorage.setItem('youkeep:client-owner', 'u1');
  window.sessionStorage.setItem('landing_applied', 'u1');
  useState('music_player_audio_el').value = fakeAudio();
  useState('podcast_player_audio_el').value = fakeAudio();
  useState('music_player_current_track').value = { id: 't1', title: 'Song', local_file_path: '/a.mp3' };
  useState('music_player_queue').value = [{ id: 't1' }, { id: 't2' }];
  useState('music_player_current_index').value = 0;
  useState('music_player_is_playing').value = true;
  useState('podcast_player_current_episode').value = { id: 'e1', title: 'Private episode' };
  useState('podcast_player_is_playing').value = true;
  useState('active_mini_player_type').value = 'podcast';
  useState('music_likes').value = { owner: 'u1', liked: { t1: true } };
  useState('podcast_follows').value = { owner: 'u1', followed: { s1: true } };
  useState('podcast_progress').value = { owner: 'u1', progress: { e1: { position: 10 } } };
  useState('display_prefs_for').value = 'u1';
  useState('modules_loaded').value = true;
  cacheStore = ['youkeep-static-b1'];
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => [...cacheStore]),
    delete: vi.fn(async (k: string) => { cacheStore = cacheStore.filter((c) => c !== k); return true; }),
  });
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/login') return { success: true, user: { id: 'u2', username: 'bob', role: 'user' } };
    return { success: true };
  }));
});
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('logout', () => {
  it('clears every per-user storage key but keeps the sidebar choice', async () => {
    const auth = await setupAuth();
    await auth.logout();
    for (const key of USER_LOCAL_STORAGE_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem('podcast_player_state')).toBeNull();
    expect(window.localStorage.getItem('music_player_state')).toBeNull();
    expect(window.localStorage.getItem('youkeep:search-history')).toBeNull();
    expect(window.localStorage.getItem('youkeep:client-owner')).toBeNull();
    expect(window.sessionStorage.getItem('landing_applied')).toBeNull();
    expect(window.localStorage.getItem('youkeep:sidebar-panel')).toBe('"music"');
  });

  it('stops both players and forgets their track, episode and queue', async () => {
    const music = useState<any>('music_player_audio_el').value;
    const podcast = useState<any>('podcast_player_audio_el').value;
    const auth = await setupAuth();
    await auth.logout();
    expect(music.pause).toHaveBeenCalled();
    expect(podcast.pause).toHaveBeenCalled();
    expect(useState('music_player_current_track').value).toBeNull();
    expect(useState('music_player_queue').value).toEqual([]);
    expect(useState('music_player_is_playing').value).toBe(false);
    expect(useState('podcast_player_current_episode').value).toBeNull();
    expect(useState('podcast_player_is_playing').value).toBe(false);
    expect(useState('active_mini_player_type').value).toBeNull();
  });

  it('resets the per-user caches and Cache Storage', async () => {
    const auth = await setupAuth();
    await auth.logout();
    expect(useState<any>('music_likes').value.liked).toEqual({});
    expect(useState<any>('podcast_follows').value.followed).toEqual({});
    expect(useState<any>('podcast_progress').value.progress).toEqual({});
    expect(useState('display_prefs_for').value).toBeUndefined();
    expect(useState('modules_loaded').value).toBe(false);
    expect(cacheStore).toEqual([]);
    expect(useState('auth_user').value).toBeNull();
  });
});

describe('login as a different user', () => {
  it('drops the previous user leftovers', async () => {
    const auth = await setupAuth();
    await auth.login('bob', 'secret-123');
    expect(window.localStorage.getItem('music_player_state')).toBeNull();
    expect(useState('podcast_player_current_episode').value).toBeNull();
    expect(window.localStorage.getItem('youkeep:client-owner')).toBe('u2');
  });

  it('keeps the state of the same user signing in again', async () => {
    window.localStorage.setItem('youkeep:client-owner', 'u2');
    const auth = await setupAuth();
    await auth.login('bob', 'secret-123');
    expect(window.localStorage.getItem('music_player_state')).not.toBeNull();
  });
});
