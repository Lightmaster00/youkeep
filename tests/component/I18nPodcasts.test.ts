import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import PodcastsIndex from '../../app/pages/podcasts/index.vue';
import SubscribedPage from '../../app/pages/podcasts/subscribed.vue';
import HistoryPage from '../../app/pages/podcasts/history.vue';
import DiscoverPage from '../../app/pages/podcasts/discover.vue';
import PodcastMiniPlayer from '../../app/components/PodcastMiniPlayer.vue';
import { usePodcastPlayer } from '../../app/composables/usePodcastPlayer';
import { useToast } from '../../app/composables/useToast';

// The podcasts area in French: labels, plurals (0 is singular), counts, dates, language names, day
// headings and player controls follow the UI language; English stays covered by the existing tests.
// Show and episode titles are data and are never translated.
const fetchMock = vi.fn();
type Handler = (url: string, opts: any) => any;
let handler: Handler = () => ({});

const NOW = Date.now();
const episode = (i: number, extra: any = {}) => ({
  id: `e${i}`, title: `Episode ${i}`, show_id: 's1', show_title: 'The Show', duration: 1000,
  download_status: 'completed', local_file_path: `/p/e${i}`, pub_date: '2026-01-15T12:00:00Z', progress: null, ...extra,
});
const show = (id: string, extra: any = {}) => ({ id, title: `Show ${id}`, episode_count: 4, ...extra });

beforeEach(async () => {
  fetchMock.mockReset();
  handler = () => ({});
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => handler(url, opts));
  vi.stubGlobal('$fetch', fetchMock);
  useToast().toasts.value.splice(0);
  useState('auth_loading').value = false;
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  useState('podcast_follows').value = { owner: null, followed: {} };
  useState('podcast_progress').value = { owner: null, progress: {} };
  useState('podcast_player_current_episode').value = null;
  window.localStorage.removeItem('podcast_player_state');
  await useNuxtApp().$i18n.setLocale('fr');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  useState('auth_user').value = null;
  await useNuxtApp().$i18n.setLocale('en');
});

const text = (w: any) => w.text().replace(/\s+/g, ' ');
const buttonByText = (w: any, label: string) => w.findAll('button').find((b: any) => b.text() === label)!;

describe('podcasts library in French', () => {
  it('words the search box, show cards, counts and follow buttons in French', async () => {
    handler = (url) => {
      if (url === '/api/podcasts/shows') return { shows: [show('a', { episode_count: 1 }), show('b', { episode_count: 1200 })] };
      if (url === '/api/podcasts/follows/status') return { followed: ['a'] };
      return undefined;
    };
    const w = await mountSuspended(PodcastsIndex, { route: { path: '/podcasts', query: {} } });
    await flushPromises();
    await flushPromises();
    expect(w.find('input.podcast-search-input').attributes('placeholder')).toBe('Rechercher un podcast ou un épisode...');
    expect(w.findAll('.show-card-title').map((l) => l.text())).toEqual(['Show a', 'Show b']);
    expect(w.findAll('.show-card-meta').map((l) => l.text())).toEqual(['1 épisode', '1 200 épisodes']);
    expect(w.findAll('.show-follow-btn').map((b) => b.text())).toEqual(['Suivi', 'Suivre']);
    expect(w.findAll('.show-card')[1]!.attributes('aria-label')).toBe('Ouvrir Show b');
    expect(w.findAll('.show-follow-btn')[1]!.attributes('aria-label')).toBe('Suivre Show b');
    w.unmount();
  });

  it('words the empty and failure states in French', async () => {
    handler = () => ({ shows: [] });
    let w = await mountSuspended(PodcastsIndex, { route: { path: '/podcasts', query: {} } });
    await flushPromises();
    expect(text(w)).toContain('Aucun podcast archivé');
    expect(text(w)).toContain('Aucun podcast archivé pour l\'instant.');
    w.unmount();
    handler = () => { throw new Error('boom'); };
    w = await mountSuspended(PodcastsIndex, { route: { path: '/podcasts', query: {} } });
    await flushPromises();
    expect(text(w)).toContain('Impossible de charger les podcasts.');
    w.unmount();
  });

  it('words the show page, its episode rows, dates and statuses in French', async () => {
    handler = (url) => {
      if (url === '/api/podcasts/shows/s1') return { show: show('s1') };
      if (url === '/api/podcasts/shows/s1/episodes') {
        return { episodes: [episode(1), episode(2, { download_status: 'pending', local_file_path: null }), episode(3, { download_status: 'failed', pub_date: 'not a date' })], total: 3 };
      }
      return undefined;
    };
    const w = await mountSuspended(PodcastsIndex, { route: { path: '/podcasts', query: { showId: 's1' } } });
    await flushPromises();
    await flushPromises();
    expect(text(w)).toContain('Podcasts');
    expect(w.findAll('.episode-title').map((l) => l.text())).toEqual(['Episode 1', 'Episode 2', 'Episode 3']);
    expect(w.findAll('.episode-meta')[0]!.text()).toContain('15 janv. 2026');
    // A date the runtime cannot parse is shown as it came.
    expect(w.findAll('.episode-meta')[2]!.text()).toContain('not a date');
    expect(w.findAll('.episode .badge, .episode-actions .badge').map((b) => b.text())).toEqual(['Téléchargé', 'En attente', 'Échec']);
    expect(w.find('.episode-play-btn').attributes('aria-label')).toBe('Lire l\'épisode');
    w.unmount();
  });
});

describe('subscribed in French', () => {
  it('words the heading, new badges, plurals, progress and the load more button', async () => {
    handler = (url) => {
      if (url === '/api/podcasts/follows') return [show('s1', { newCount: 3, followedAt: 1 }), show('s2', { episode_count: 0, followedAt: 1 })];
      if (url === '/api/podcasts/continue') return { items: [episode(9, { progress: { positionSeconds: 500, durationSeconds: 1000, completed: false, updatedAt: 1 } })] };
      if (url === '/api/podcasts/subscribed-episodes') return { items: [episode(1, { progress: { positionSeconds: 1000, durationSeconds: 1000, completed: true, updatedAt: 1 } })], total: 3 };
      return undefined;
    };
    const w = await mountSuspended(SubscribedPage);
    await flushPromises();
    expect(w.find('h1').text()).toBe('Abonné');
    expect(text(w)).toContain('Reprendre la lecture');
    expect(text(w)).toContain('Vos émissions');
    expect(text(w)).toContain('Les derniers épisodes de vos émissions');
    expect(w.findAll('.show-card-new').map((b) => b.text())).toEqual(['3 nouveaux']);
    // 0 is singular in French.
    expect(w.findAll('.show-card-meta').map((b) => b.text())).toEqual(['4 épisodes', '0 épisode']);
    expect(w.findAll('.show-follow-btn').map((b) => b.text())).toEqual(['Suivi', 'Suivi']);
    expect(w.find('.continue-row [role="progressbar"]').attributes('aria-label')).toBe('Progression d\'écoute');
    expect(w.find('.episode-progress-played').text()).toBe('Écouté');
    expect(buttonByText(w, 'Charger plus')).toBeTruthy();
    w.unmount();
  });

  it('words the empty and guest states and the mark-as-played menu in French', async () => {
    handler = (url) => (url === '/api/podcasts/follows' ? [] : url === '/api/podcasts/continue' ? { items: [] } : { items: [], total: 0 });
    let w = await mountSuspended(SubscribedPage);
    await flushPromises();
    expect(text(w)).toContain('Vous ne suivez encore aucune émission');
    expect(text(w)).toContain('Rien en cours');
    w.unmount();

    handler = (url) => (url === '/api/podcasts/follows' ? [show('s1', { followedAt: 1 })] : url === '/api/podcasts/subscribed-episodes' ? { items: [episode(1)], total: 1 } : { items: [] });
    w = await mountSuspended(SubscribedPage, { attachTo: document.body });
    await flushPromises();
    await w.find('.episode-menu-btn').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('.episode-menu-item')!.textContent!.trim()).toBe('Marquer comme écouté');
    w.unmount();

    useState<any>('auth_user').value = null;
    w = await mountSuspended(SubscribedPage);
    await flushPromises();
    expect(text(w)).toContain('Connectez-vous pour suivre des émissions');
    w.unmount();
  });

  it('words a refused follow change in French', async () => {
    handler = (url, opts) => {
      if (opts?.method === 'DELETE') throw new Error('nope');
      if (url === '/api/podcasts/follows') return [show('s1', { followedAt: 1 })];
      return { items: [], total: 0 };
    };
    const w = await mountSuspended(SubscribedPage);
    await flushPromises();
    await w.find('.show-follow-btn').trigger('click');
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Impossible de ne plus suivre l\'émission.');
    w.unmount();
  });
});

describe('podcast history in French', () => {
  const progress = (completed = false) => ({ positionSeconds: 250, durationSeconds: 1000, completed, updatedAt: NOW });

  it('words the title, day heading, remove button and clear dialog in French', async () => {
    handler = (url) => (url === '/api/podcasts/history' ? { items: [episode(1, { progress: progress() })], total: 1 } : undefined);
    const w = await mountSuspended(HistoryPage, { attachTo: document.body });
    await flushPromises();
    expect(w.find('h1').text()).toBe('Historique');
    expect(w.find('.history-day-heading').text()).toBe('Aujourd\'hui');
    const remove = w.find('.history-remove-btn');
    expect(remove.attributes('aria-label')).toBe('Retirer Episode 1 de l\'historique');
    expect(remove.attributes('title')).toBe('Retirer de l\'historique. Réinitialise aussi la position de reprise.');
    await buttonByText(w, 'Effacer l\'historique').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Effacer l\'historique ?');
    expect(document.body.textContent).toContain('positions de reprise');
    w.unmount();
  });

  it('words the empty, guest and failure states in French', async () => {
    handler = () => ({ items: [], total: 0 });
    let w = await mountSuspended(HistoryPage);
    await flushPromises();
    expect(text(w)).toContain('Aucun historique d\'écoute pour l\'instant');
    w.unmount();

    handler = (url, opts) => {
      if (opts?.method === 'DELETE') throw new Error('nope');
      return { items: [episode(1, { progress: progress() })], total: 1 };
    };
    w = await mountSuspended(HistoryPage);
    await flushPromises();
    await w.find('.history-remove-btn').trigger('click');
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Impossible de retirer l\'épisode de votre historique.');
    w.unmount();

    useState<any>('auth_user').value = null;
    w = await mountSuspended(HistoryPage);
    await flushPromises();
    expect(text(w)).toContain('Connectez-vous pour voir votre historique');
    w.unmount();
  });
});

describe('podcast discover in French', () => {
  const FULL: Handler = (url) => {
    if (url === '/api/podcasts/discover/popular') return { shows: [show('p1', { followerCount: 5 }), show('p2', { followerCount: 1 }), show('p3', { followerCount: 0 })] };
    if (url === '/api/podcasts/discover/recently-updated') return { shows: [show('r1', { latestEpisodeTitle: 'Latest one', latestEpisodeAt: Date.UTC(2026, 0, 15, 12) })] };
    if (url === '/api/podcasts/discover/trending') return { episodes: [episode(1, { listenerCount: 3 }), episode(2, { listenerCount: 1 })] };
    if (url === '/api/podcasts/discover/because-you-follow') return { basedOn: { id: 'm', title: 'My Show' }, shows: [show('sg')] };
    if (url === '/api/podcasts/discover/languages') return { languages: [{ language: 'en', showCount: 4 }, { language: 'fr', showCount: 1 }] };
    return undefined;
  };

  it('words the rows, counts, dates and language chips (named in French) in French', async () => {
    handler = FULL;
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(w.find('h1').text()).toBe('Découvrir');
    expect(w.findAll('.discover-row-title').map((t) => t.text())).toEqual([
      'Populaires auprès des auditeurs', 'Mises à jour récemment', 'Épisodes tendance', 'Parce que vous suivez My Show',
    ]);
    expect(w.findAll('.show-card-detail').map((d) => d.text()).slice(0, 4)).toEqual(['5 abonnés', '1 abonné', '0 abonné', 'Latest one · 15 janv. 2026']);
    expect(w.findAll('.episode-context').map((c) => c.text())).toEqual(['The Show · 3 auditeurs', 'The Show · 1 auditeur']);
    expect(text(w)).toContain('Parcourir par langue');
    expect(w.find('.language-chips').attributes('aria-label')).toBe('Filtrer par langue');
    expect(w.findAll('.language-chip').map((c) => c.text())).toEqual(['Toutes', 'anglais 4', 'français 1']);
    w.unmount();
  });

  it('words the empty state and the empty language in French', async () => {
    handler = (url) => (url === '/api/podcasts/discover/languages' ? { languages: [] } : url.includes('discover') ? { shows: [], episodes: [] } : undefined);
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(text(w)).toContain('Rien à découvrir pour l\'instant');
    w.unmount();
  });
});

describe('podcast mini player in French', () => {
  async function mountPlayer() {
    const w = await mountSuspended(PodcastMiniPlayer);
    usePodcastPlayer().currentEpisode.value = { id: 'e1', title: 'E1', show_title: 'The Show', duration: 3600, local_file_path: '/p/e1.mp3' };
    await flushPromises();
    return w;
  }

  it('words every control in French and keeps the episode data as is', async () => {
    const w = await mountPlayer();
    expect(w.find('.podcast-mini-player-title').text()).toBe('E1');
    expect(w.find('.podcast-mini-player-show').text()).toBe('The Show');
    const labels = w.findAll('[aria-label]').map((e) => e.attributes('aria-label'));
    for (const l of ['Reculer de 15 secondes', 'Lire', 'Avancer de 30 secondes', 'Position de lecture', 'Vitesse de lecture']) {
      expect(labels).toContain(l);
    }
    expect(w.find('[data-testid="podcast-seek"]').attributes('aria-valuetext')).toBe('0:00 sur 1:00:00');
    w.unmount();
  });

  it('words the playback speeds with the French decimal comma and the playback error', async () => {
    const w = await mountPlayer();
    expect(w.findAll('.podcast-mini-player-rate option').map((o) => o.text())).toContain('1,5×');
    w.find('audio').element.dispatchEvent(new Event('error'));
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Erreur de lecture de l\'épisode.');
    w.unmount();
  });
});
