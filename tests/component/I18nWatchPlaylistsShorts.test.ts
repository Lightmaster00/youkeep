import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import WatchPage from '../../app/pages/watch/[id].vue';
import PlaylistsIndex from '../../app/pages/playlists/index.vue';
import PlaylistPage from '../../app/pages/playlists/[id].vue';
import ShortsPage from '../../app/pages/shorts.vue';
import VideoPlayer from '../../app/components/VideoPlayer.vue';
import { buildView } from '../../shared/displayPrefs';
import { useToast } from '../../app/composables/useToast';

// Watch, playlists and Shorts pages in French: labels, plurals (0 is singular), counts,
// dates and byte sizes follow the UI language; English stays covered by the existing tests.
const { requestFetchMock } = vi.hoisted(() => ({ requestFetchMock: vi.fn() }));
mockNuxtImport('useRequestFetch', () => () => requestFetchMock);

const fetchMock = vi.fn();

beforeEach(async () => {
  clearNuxtData();
  useToast().toasts.value.splice(0);
  useState('auth_loading').value = false;
  useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  useState('display_prefs_for').value = 'u1';
  useState('display_prefs').value = buildView({}, null);
  requestFetchMock.mockReset();
  requestFetchMock.mockResolvedValue({ videos: [] });
  vi.stubGlobal('$fetch', fetchMock);
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  await useNuxtApp().$i18n.setLocale('fr');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  useState('auth_user').value = null;
  await useNuxtApp().$i18n.setLocale('en');
});

describe('watch page in French', () => {
  const video = {
    id: 'vid1', title: 'A video', channel_id: 'ch1', channel_title: 'Chan', visibility: 'public', publicly_shareable: 1,
    local_video_path: '/media/v/vid1.mkv', download_status: 'completed', view_count: 1500, like_count: 2300, upload_date: '20260315',
    size_bytes: 1536, created_at: 1773000000000, description: '',
  };
  const mountWatch = async (reply: any) => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => (url.startsWith('/api/videos/vid1') ? reply : { videos: [], playlists: [] }));
    const w = await mountSuspended(WatchPage, { route: { path: '/watch/vid1', query: {} }, global: { stubs: { VideoPlayer: true } }, attachTo: document.body });
    await flushPromises();
    return w;
  };

  it('words the video header, counts, dates, sizes and empty states in French', async () => {
    const w = await mountWatch({ video, comments: [] });
    const text = w.text().replace(/\s/g, ' ');
    expect(text).toContain('1,5 k vues');
    expect(text).toContain('2,3 k mentions J\'aime');
    expect(text).toContain('15 mars 2026');
    expect(text).toContain('Archivée dans YouKeep');
    expect(text).toContain('Aucune description disponible.');
    expect(text).toContain('Détails techniques de l\'archive');
    expect(text).toContain('Espace disque occupé');
    expect(text).toContain('1,5 Ko');
    // "0 comments" is singular in French.
    expect(text).toContain('0 commentaire');
    expect(text).not.toContain('0 commentaires');
    expect(text).toContain('Aucun commentaire archivé pour cette vidéo.');
    expect(text).toContain('Autres vidéos archivées');
    expect(text).toContain('Aucune autre vidéo archivée disponible.');
    expect(text).toContain('Partager');
    expect(w.find('[data-testid="watch-more"]').attributes('aria-label')).toBe('Plus d\'options');
    await w.find('[data-testid="watch-more"]').trigger('click');
    expect(w.find('[data-testid="watch-options-menu"]').text().replace(/\s+/g, ' ')).toBe('Enregistrer Télécharger Signaler');
    expect(w.find('.toggle-desc-btn').text()).toBe('Afficher plus');
    w.unmount();
  });

  it('words a missing video in French', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => { throw Object.assign(new Error('404'), { statusCode: 404 }); });
    const w = await mountSuspended(WatchPage, { route: { path: '/watch/vid1', query: {} }, global: { stubs: { VideoPlayer: true } } });
    await flushPromises();
    const nf = w.find('[data-testid="video-not-found"]');
    expect(nf.text()).toContain('Vidéo introuvable');
    expect(nf.text()).toContain('Retour à l\'accueil');
    w.unmount();
  });

  it('the report modal is French', async () => {
    const w = await mountWatch({ video, comments: [] });
    await w.find('[data-testid="watch-more"]').trigger('click');
    await w.find('[data-testid="watch-report"]').trigger('click');
    await flushPromises();
    const modal = document.body.querySelector('.modal-card')!;
    expect(modal.textContent).toContain('Signaler la vidéo');
    expect(modal.textContent).toContain('Quel est le problème avec cette vidéo ?');
    expect(modal.textContent).toContain('Annuler');
    expect(modal.querySelector('.close-modal-btn')!.getAttribute('aria-label')).toBe('Fermer');
    w.unmount();
  });
});

describe('video player in French', () => {
  it('titles its controls in French', async () => {
    const w = await mountSuspended(VideoPlayer, {
      props: { video: { id: 'v1', title: 'T', local_video_path: '/v.mp4' }, subtitles: [{ code: 'en', label: 'English', url: '/s.vtt' }], hasPrevVideo: true, hasNextVideo: true },
    });
    const titles = w.findAll('[title]').map(e => e.attributes('title'));
    expect(titles).toEqual(expect.arrayContaining([
      'Lecture (Espace)', 'Vidéo précédente', 'Vidéo suivante', 'Reculer de 10 s (←)', 'Avancer de 10 s (→)',
      'Couper le son (M)', 'Vitesse de lecture', 'Sous-titres', 'Mode cinéma', 'Plein écran (F)',
    ]));
    w.unmount();
  });
});

describe('playlists in French', () => {
  const playlist = { id: 'p1', title: 'Road trip', visibility: 'private', owner_name: 'alice', share_token: null, description: '' };

  it('the list words counts (0 is singular), visibility and the owner line', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => (url === '/api/playlists/personal'
      ? { playlists: [
        { id: 'p1', title: 'Road trip', visibility: 'private', video_count: 2, owner_name: 'alice', created_at: Date.UTC(2026, 2, 15, 12) },
        { id: 'p2', title: 'Chill', visibility: 'public', video_count: 0, owner_name: 'bob' },
      ] }
      : {}));
    const w = await mountSuspended(PlaylistsIndex, { route: '/playlists' });
    await flushPromises();
    const text = w.text().replace(/\s+/g, ' ');
    expect(text).toContain('Playlists personnelles');
    expect(text).toContain('Créer une playlist');
    expect(text).toContain('2 vidéos');
    expect(text).toContain('0 vidéo');
    expect(text).not.toContain('0 vidéos');
    expect(text).toContain('Privée');
    expect(text).toContain('Publique');
    expect(text).toContain('par alice');
    expect(text).toContain('15 mars 2026');
    expect(text).toContain('TOUT LIRE');
    expect(w.find('.playlist-card').attributes('aria-label')).toBe('Ouvrir Road trip');
    w.unmount();
  });

  it('the empty list and the create dialog are French', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({ playlists: [] }));
    const w = await mountSuspended(PlaylistsIndex, { route: '/playlists', attachTo: document.body });
    await flushPromises();
    expect(w.text()).toContain('Votre collection commence ici');
    expect(w.text()).toContain('Créer votre première playlist');
    w.unmount();
  });

  it('the playlist page words its sidebar, rows, empty state and settings in French', async () => {
    const videos = [
      { id: 'v1', title: 'First clip', channel_title: 'Chan', duration: 61, view_count: 1500, is_short: 0 },
      { id: 's1', title: 'A short', channel_title: 'Chan', duration: 20, view_count: 3, is_short: 1 },
    ];
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => (url.startsWith('/api/playlists/personal/p1') ? { playlist, videos } : {}));
    const w = await mountSuspended(PlaylistPage, { route: { path: '/playlists/p1', params: { id: 'p1' }, query: {} } as any, attachTo: document.body });
    await flushPromises();
    const text = w.text().replace(/\s+/g, ' ');
    expect(text).toContain('Privée');
    expect(text).toContain('2 vidéos');
    expect(text).toContain('Créée par alice');
    expect(text).toContain('Tout lire');
    expect(text).toContain('Réglages');
    expect(text).toContain('1,5 k vues');
    expect(w.findAll('.playlist-kind-title').map(h => h.text())).toEqual(['Vidéos', 'Shorts']);
    expect(w.find('.video-row').attributes('aria-label')).toBe('Lire First clip');
    expect(w.find('.btn-remove-video').attributes('title')).toBe('Retirer de la playlist');
    await w.find('.btn.btn-secondary').trigger('click');
    await flushPromises();
    const modal = document.body.querySelector('.modal-card')!.textContent!;
    expect(modal).toContain('Réglages de la playlist');
    expect(modal).toContain('Lien de partage');
    expect(modal).toContain('Votre playlist est privée.');
    w.unmount();
  });

  it('an emptied playlist says so in French', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => (url.startsWith('/api/playlists/personal/p1') ? { playlist, videos: [] } : {}));
    const w = await mountSuspended(PlaylistPage, { route: { path: '/playlists/p1', params: { id: 'p1' }, query: {} } as any });
    await flushPromises();
    expect(w.text()).toContain('Aucune vidéo dans cette playlist pour l\'instant');
    expect(w.text()).toContain('0 vidéo');
    expect(w.text()).not.toContain('0 vidéos');
    w.unmount();
  });
});

describe('Shorts in French', () => {
  it('words the empty state and the comments pane in French', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/videos/recommend') return { videos: [] };
      return {};
    });
    const empty = await mountSuspended(ShortsPage, { route: '/shorts' });
    await flushPromises();
    expect(empty.text()).toContain('Aucun Short disponible');
    expect(empty.text()).toContain('Retour à l\'accueil');
    empty.unmount();

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/videos/recommend') return { videos: [{ id: 's1', title: 'A short', channel_title: 'C', channel_id: 'c1', is_short: 1, publicly_shareable: 1, local_video_path: '/m/s1.mp4', upload_date: '20260315' }] };
      if (url.startsWith('/api/videos/s1')) return { video: { id: 's1' }, comments: [] };
      return {};
    });
    const w = await mountSuspended(ShortsPage, { route: '/shorts' });
    await flushPromises();
    const options = w.findAll('.comment-sort-select option').map(o => o.text());
    expect(options).toEqual(['Meilleurs commentaires', 'Plus récents d\'abord', 'Plus anciens d\'abord']);
    expect(w.text()).toContain('Commentaires (0)');
    expect(w.text()).toContain('Aucun commentaire pour ce Short.');
    expect(w.find('.share-btn-top').attributes('aria-label')).toBe('Partager');
    w.unmount();
  });
});
