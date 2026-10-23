import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import MusicIndex from '../../app/pages/music/index.vue';
import AlbumPage from '../../app/pages/music/album/[id].vue';
import DiscoverPage from '../../app/pages/music/discover.vue';
import LikedPage from '../../app/pages/music/liked.vue';
import HistoryPage from '../../app/pages/music/history.vue';
import PlaylistsPage from '../../app/pages/music/playlists/index.vue';
import PlaylistPage from '../../app/pages/music/playlists/[id].vue';
import MusicMiniPlayer from '../../app/components/MusicMiniPlayer.vue';
import { useMusicPlayer } from '../../app/composables/useMusicPlayer';
import { useToast } from '../../app/composables/useToast';
import { buildView } from '../../shared/displayPrefs';

// The music area in French: labels, plurals (0 is singular), counts, mix names, day headings and
// player controls follow the UI language; English stays covered by the existing tests. Titles,
// artist and genre names are data and are never translated.
const fetchMock = vi.fn();
type Handler = (url: string, opts: any) => any;
let handler: Handler = () => ({});

const track = (i: number, extra: any = {}) => ({
  id: `t${i}`, title: `Song ${i}`, track_number: i, artist_id: 'a1', artist_name: 'Band',
  album_id: 'al1', album_title: 'Record', local_file_path: `/m/t${i}`, duration: 61, ...extra,
});

beforeEach(async () => {
  fetchMock.mockReset();
  handler = () => ({});
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
    if (url === '/api/music/favorites/status') return { liked: [] };
    return handler(url, opts);
  });
  vi.stubGlobal('$fetch', fetchMock);
  useToast().toasts.value.splice(0);
  useState('auth_loading').value = false;
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  useState('display_prefs_for').value = 'u1';
  useState('display_prefs').value = buildView({}, null);
  useState('music_likes').value = { owner: null, liked: {} };
  useState('music_player_current_track').value = null;
  useState('music_player_queue').value = [];
  useState('music_player_current_index').value = -1;
  useState('music_player_shuffle').value = false;
  useState('music_player_repeat').value = 'off';
  await useNuxtApp().$i18n.setLocale('fr');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  useState('auth_user').value = null;
  await useNuxtApp().$i18n.setLocale('en');
});

const text = (w: any) => w.text().replace(/\s+/g, ' ');

describe('music library in French', () => {
  const artists = { artists: [{ id: 'a1', name: 'Band', avatar_url: null, track_count: 1 }, { id: 'a2', name: 'Duo', avatar_url: null, track_count: 1200 }], facets: { genres: ['Hip Hop'], languages: ['fr'], years: [2020] } };

  it('words filters, cards, counts and automatic playlists in French', async () => {
    handler = (url) => {
      if (url === '/api/music/artists') return artists;
      if (url === '/api/music/playlists/most-played') return { tracks: [track(1), track(2)] };
      if (url === '/api/music/playlists/genre-mix') return { tracks: [track(3)] };
      return { tracks: [] };
    };
    const w = await mountSuspended(MusicIndex, { route: { path: '/music', query: {} } });
    await flushPromises();
    await flushPromises();
    const t = text(w);
    expect(w.find('input.music-search-input').attributes('placeholder')).toBe('Rechercher un artiste ou un titre...');
    expect(t).toContain('Tous les genres');
    expect(t).toContain('Toutes les langues');
    expect(t).toContain('Toutes les années');
    // Language names follow the UI language; artist and genre names stay as they are.
    expect(w.findAll('select')[1]!.text()).toContain('français');
    expect(t).toContain('Hip Hop');
    expect(w.findAll('.playlist-card-label').map((l) => l.text())).toEqual(['Les plus écoutés', 'Mix Hip Hop']);
    expect(w.findAll('.playlist-card-count').map((l) => l.text())).toEqual(['2 titres', '1 titre']);
    expect(w.findAll('.artist-card-meta').map((l) => l.text())).toEqual(['1 titre', '1\u202f200 titres']);
    expect(w.findAll('.artist-card-name').map((l) => l.text())).toEqual(['Band', 'Duo']);
    w.unmount();
  });

  it('words the empty and failure states in French', async () => {
    handler = () => ({ artists: [], facets: { genres: [], languages: [], years: [] } });
    const w = await mountSuspended(MusicIndex, { route: { path: '/music', query: {} } });
    await flushPromises();
    expect(text(w)).toContain('Aucun artiste archivé');
    expect(text(w)).toContain('Aucun artiste archivé pour l\'instant.');
    w.unmount();
    handler = () => { throw new Error('down'); };
    const failed = await mountSuspended(MusicIndex, { route: { path: '/music', query: {} } });
    await flushPromises();
    expect(text(failed)).toContain('Impossible de charger les artistes.');
    failed.unmount();
  });
});

describe('album page in French', () => {
  const album = { id: 'al1', title: 'Record', year: 2015, type: 'ep', coverUrl: null, manualCoverUrl: null, artistId: 'a1', artistName: 'Band' };

  it('words the header, track list and actions in French', async () => {
    handler = (url) => (url === '/api/music/albums/al1' ? { album, tracks: [track(1), track(2)] } : {});
    const w = await mountSuspended(AlbumPage, { route: '/music/album/al1' });
    await flushPromises();
    const t = text(w);
    expect(t).toContain('EP');
    expect(t).toContain('2015 · 2 titres');
    expect(t).toContain('Lire');
    expect(t).toContain('Lecture aléatoire');
    expect(w.find('.mtl-row').attributes('aria-label')).toBe('Lire Song 1');
    // The title and the artist are data.
    expect(w.find('h1').text()).toBe('Record');
    expect(w.find('[data-testid="album-artist-link"]').text()).toBe('Band');
    // Signed-in user: like and add-to-playlist buttons are French.
    expect(w.find('.track-like-btn').attributes('aria-label')).toBe('Ajouter aux titres likés');
    w.unmount();
  });

  it('words a missing album and an empty one in French', async () => {
    handler = () => { throw Object.assign(new Error('nf'), { statusCode: 404 }); };
    const missing = await mountSuspended(AlbumPage, { route: '/music/album/zz' });
    await flushPromises();
    expect(text(missing)).toContain('Album introuvable.');
    missing.unmount();
    handler = (url) => (url === '/api/music/albums/al1' ? { album, tracks: [] } : {});
    const empty = await mountSuspended(AlbumPage, { route: '/music/album/al1' });
    await flushPromises();
    expect(text(empty)).toContain('Aucun titre téléchargé');
    empty.unmount();
  });

  it('keeps the admin album editor button in English', async () => {
    useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'admin' };
    handler = (url) => (url === '/api/music/albums/al1' ? { album, tracks: [track(1)] } : {});
    const w = await mountSuspended(AlbumPage, { route: '/music/album/al1' });
    await flushPromises();
    expect(w.find('[data-testid="album-edit"]').text()).toBe('Edit album');
    w.unmount();
  });
});

describe('discover, liked songs and history in French', () => {
  it('words the Discover rows and mixes in French', async () => {
    handler = (url) => {
      if (url === '/api/music/playlists/liked-mix') return { tracks: [track(1)] };
      if (url === '/api/music/playlists/most-played') return { tracks: [track(2, { play_count: 3 })] };
      if (url === '/api/music/playlists/artist-mix') return { tracks: [track(3), track(4)] };
      if (url === '/api/music/genres') return { genres: [{ genre: 'Hip Hop', trackCount: 3 }] };
      if (url === '/api/music/albums/recent') return { albums: [{ id: 'al1', title: 'First', artist_name: 'Nine', release_year: 2020, trackCount: 4 }] };
      return { tracks: [], albums: [], artists: [] };
    };
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(w.find('h1').text()).toBe('Découvrir');
    expect(w.findAll('.discover-row-title').map((t) => t.text())).toEqual(['Conçu pour vous', 'Parcourir par genre', 'Nouveaux albums']);
    expect(w.findAll('.mix-tile-title').map((t) => t.text())).toEqual(['Mix de vos titres likés', 'Les plus écoutés', 'Mix Band']);
    expect(w.findAll('.mix-tile-meta').map((t) => t.text())).toEqual(['1 titre', '1 titre', '2 titres']);
    expect(w.find('.genre-tile').text()).toBe('Hip Hop3 titres');
    expect(w.find('.album-tile').text()).toContain('Nine · 2020');
    expect(w.find('.album-tile').text()).toContain('4 titres');
    w.unmount();
  });

  it('words the Discover radio tile and its failure in French', async () => {
    useState('music_player_current_track').value = track(9, { title: 'Seed' });
    handler = (url) => { if (url === '/api/music/playlists/radio') throw new Error('x'); return { tracks: [], albums: [], artists: [], genres: [] }; };
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(w.find('.mix-tile-title').text()).toBe('Radio');
    expect(w.find('.mix-tile-meta').text()).toBe('À partir de Seed');
    await w.find('.mix-tile').trigger('click');
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Impossible de lancer la radio.');
    w.unmount();
  });

  it('words Liked songs and a failing unlike in French', async () => {
    handler = (url) => (url === '/api/music/favorites' ? { items: [track(1)], total: 1 } : { success: true });
    const w = await mountSuspended(LikedPage);
    await flushPromises();
    expect(text(w)).toContain('Titres likés');
    expect(text(w)).toContain('1 titre');
    expect(w.find('.track-like-btn').attributes('aria-label')).toBe('Retirer des titres likés');
    handler = (url, opts) => { if (opts?.method === 'DELETE') throw new Error('x'); return {}; };
    await w.find('.track-like-btn').trigger('click');
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Impossible de retirer le titre des titres likés.');
    w.unmount();
  });

  it('words History, its day headings (Aujourd\'hui) and the clear dialog in French', async () => {
    handler = (url) => (url === '/api/music/history' ? { items: [{ ...track(1), playedAt: Date.now() }], total: 1 } : { success: true });
    const w = await mountSuspended(HistoryPage, { attachTo: document.body });
    await flushPromises();
    expect(w.find('h1').text()).toBe('Historique');
    expect(w.find('.history-day-heading').text()).toBe('Aujourd\'hui');
    expect(w.find('.history-remove-btn').attributes('aria-label')).toBe('Retirer Song 1 de l\'historique');
    await buttonByText(w, 'Effacer l\'historique').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Effacer l\'historique ?');
    w.unmount();
  });
});

function buttonByText(w: any, label: string) {
  return w.findAll('button').find((b: any) => b.text() === label)!;
}

describe('playlists in French', () => {
  it('words the playlist list, counts and create form in French', async () => {
    handler = () => [
      { id: 'p1', title: 'Gym', trackCount: 1, coverUrls: [] },
      { id: 'p2', title: 'Sleep', trackCount: 12, coverUrls: [] },
    ];
    const w = await mountSuspended(PlaylistsPage);
    await flushPromises();
    expect(w.find('h1').text()).toBe('Playlists');
    expect(w.findAll('.upl-card').map((c) => c.text())).toEqual(['Gym1 titre', 'Sleep12 titres']);
    await buttonByText(w, 'Nouvelle playlist').trigger('click');
    expect(w.find('#upl-title').attributes('placeholder')).toBe('Ma playlist');
    expect(text(w)).toContain('Description (facultative)');
    expect(buttonByText(w, 'Annuler')).toBeTruthy();
    expect(buttonByText(w, 'Créer')).toBeTruthy();
    w.unmount();
  });

  it('words an empty list and a created playlist in French', async () => {
    handler = (url, opts) => (opts?.method === 'POST' ? { id: 'p1', title: 'Gym', trackCount: 0, coverUrls: [] } : []);
    const w = await mountSuspended(PlaylistsPage);
    await flushPromises();
    expect(text(w)).toContain('Aucune playlist pour l\'instant');
    await buttonByText(w, 'Nouvelle playlist').trigger('click');
    await w.find('#upl-title').setValue('Gym');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Gym créée');
    expect(w.find('.upl-card-meta').text()).toBe('0 titre');
    w.unmount();
  });

  it('words the playlist page, its row buttons and its delete dialog in French', async () => {
    handler = (url) => (url === '/api/music/user-playlists/p1'
      ? { playlist: { id: 'p1', title: 'Gym', description: 'Loud', trackCount: 2, coverUrls: [] }, tracks: [track(1), track(2)] }
      : { success: true });
    const w = await mountSuspended(PlaylistPage, { route: '/music/playlists/p1', attachTo: document.body });
    await flushPromises();
    expect(w.find('h1').text()).toBe('Gym');
    expect(text(w)).toContain('Playlist');
    expect(text(w)).toContain('2 titres');
    expect(buttonByText(w, 'Modifier')).toBeTruthy();
    const up = w.findAll('.pd-row-btn');
    expect(up[0]!.attributes('aria-label')).toBe('Monter Song 1');
    expect(up[1]!.attributes('aria-label')).toBe('Descendre Song 1');
    expect(up[2]!.attributes('aria-label')).toBe('Retirer Song 1 de cette playlist');
    await buttonByText(w, 'Supprimer la playlist').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('« Gym » sera supprimée. Les titres restent dans votre bibliothèque.');
    w.unmount();
  });

  it('words a missing playlist in French', async () => {
    handler = () => { throw Object.assign(new Error('nf'), { statusCode: 404 }); };
    const w = await mountSuspended(PlaylistPage, { route: '/music/playlists/zz' });
    await flushPromises();
    expect(text(w)).toContain('Playlist introuvable');
    w.unmount();
  });
});

describe('mini player in French', () => {
  const saved = { trackId: 't1', queueTrackIds: ['t1'], currentIndex: 0, currentTime: 12, shuffleOn: false, repeatMode: 'off', lastPlayedAt: 1 };

  async function mountPlayer(extra: any = {}) {
    window.localStorage.setItem('music_player_state', JSON.stringify(saved));
    handler = (url) => (url === '/api/music/tracks/by-ids' ? { tracks: [{ id: 't1', title: 'One', artist_name: 'Band', has_clip: true, local_file_path: '/m/one.mp3', ...extra }] } : {});
    const w = await mountSuspended(MusicMiniPlayer);
    await flushPromises();
    return w;
  }

  it('words every control in French and keeps the track data as is', async () => {
    const w = await mountPlayer();
    expect(w.find('.mini-player-title').text()).toBe('One');
    const labels = w.findAll('[aria-label]').map((e) => e.attributes('aria-label'));
    for (const l of ['Précédent', 'Lire', 'Suivant', 'Autres commandes du lecteur', 'Lecture aléatoire', 'Répéter : désactivé', 'Lancer une radio', 'Volume', 'Position de lecture', 'Voir le clip']) {
      expect(labels).toContain(l);
    }
    expect(w.find('[data-testid="music-seek"]').attributes('aria-valuetext')).toBe('0:00 sur 0:00');
    w.unmount();
  });

  it('words the repeat mode and the playback error in French', async () => {
    const w = await mountPlayer();
    useState('music_player_repeat').value = 'one';
    await flushPromises();
    expect(w.findAll('[aria-label]').map((e) => e.attributes('aria-label'))).toContain('Répéter : un titre');
    const holder = useMusicPlayer();
    (w.find('video').element as HTMLVideoElement).play = vi.fn(async () => undefined) as any;
    holder.togglePlay();
    w.find('video').element.dispatchEvent(new Event('error'));
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Erreur de lecture audio.');
    w.unmount();
  });
});
