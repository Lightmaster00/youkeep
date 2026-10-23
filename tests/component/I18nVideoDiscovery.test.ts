import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import HomePage from '../../app/pages/index.vue';
import SubscriptionsPage from '../../app/pages/subscriptions.vue';
import ChannelsPage from '../../app/pages/channels.vue';
import SearchPage from '../../app/pages/search.vue';
import { buildView } from '../../shared/displayPrefs';

// useRequestFetch (cookies on SSR) goes through whatever $fetch the test stubs.
mockNuxtImport('useRequestFetch', () => () => (...args: unknown[]) => (globalThis as any).$fetch(...args));

// The video discovery pages in French: row titles and recommendation reasons are
// rebuilt from the feed's stable ids (the English text the server sends is only a fallback),
// counts, dates and relative times follow the UI language.

const ymd = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const video = (id: string, extra: object = {}) => ({
  id, title: `Title ${id}`, channel_id: 'c1', channel_title: 'Chan', channel_avatar: null, duration: 600, view_count: 1500,
  upload_date: '20260315', local_video_path: '/v.mp4', local_thumbnail_path: null, is_short: 0, isNew: false, watchedPercent: 0, ...extra,
});

beforeEach(async () => {
  clearNuxtData();
  useState('auth_loading').value = false;
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  useState('display_prefs_for').value = 'u1';
  useState('display_prefs').value = buildView({}, null);
  await useNuxtApp().$i18n.setLocale('fr');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  useState('auth_user').value = null;
  await useNuxtApp().$i18n.setLocale('en');
});

describe('home page in French', () => {
  it('words row titles, reasons, views and dates in French', async () => {
    useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
    useState('display_prefs_for').value = null;
    useState('display_prefs').value = buildView({ homeHero: false, homeSections: ['forYou', 'becauseYouWatched', 'popular', 'playlists'] }, null);
    const feed = {
      featured: { large: null, small: [] },
      sections: [
        { id: 'forYou', title: 'Recommended for you', videos: [
          video('f1', { reason: { kind: 'category', label: 'Popular in Gaming', ref: { category: 'Gaming' } }, reasonKind: 'category', reasonParams: { category: 'Gaming' } }),
          video('f2', { reason: { kind: 'because-watched', label: 'Because you watched Seed' }, reasonKind: 'because-watched', reasonParams: { title: 'Seed' } }),
          video('f3', { reason: { kind: 'because-watched', label: 'Because you watched Old' } }),
        ] },
        { id: 'becauseYouWatched', title: 'Because you watched Seed', seed: { id: 'x', title: 'Seed' }, videos: [video('b1')] },
        { id: 'popular', title: 'Popular', videos: [video('p1')] },
        { id: 'playlists', title: 'Your playlists', playlists: [{ id: 'pl', title: 'Road trip', visibility: 'private', video_count: 2, cover_video_id: null, thumbnail_path: null }] },
      ],
    };
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => (url === '/api/home/feed' ? feed : {})));
    const w = await mountSuspended(HomePage, { route: '/' });
    await flushPromises();
    const text = (id: string) => w.find(`[data-testid="home-row-${id}"]`).text().replace(/\s/g, ' ');
    expect(text('forYou')).toContain('Recommandé pour vous');
    expect(text('forYou')).toContain('Populaire dans Gaming');
    expect(text('forYou')).toContain('Parce que vous avez regardé Seed');
    // No structured params: the server's English text is the fallback, never an empty line.
    expect(text('forYou')).toContain('Because you watched Old');
    expect(text('becauseYouWatched')).toContain('Parce que vous avez regardé Seed');
    expect(text('popular')).toContain('Populaires');
    expect(text('popular')).toContain('1,5 k vues');
    expect(text('popular')).toContain('15 mars 2026');
    expect(text('playlists')).toContain('Vos playlists');
    expect(text('playlists')).toContain('2 vidéos');
    expect(text('playlists')).toContain('Privée');
    expect(text('playlists')).toContain('Tout voir');
    expect(w.find('[data-testid="row-prev"]').attributes('aria-label')).toBe('Faire défiler Recommandé pour vous vers la gauche');
    w.unmount();
  });

  it('shows the French guest hint and empty state', async () => {
    useState<any>('auth_user').value = null;
    useState('display_prefs_for').value = null;
    useState('display_prefs').value = buildView({ homeHero: false, homeSections: ['popular'] }, null);
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => (url === '/api/home/feed' ? { featured: { large: null, small: [] }, sections: [] } : {})));
    const w = await mountSuspended(HomePage, { route: '/' });
    await flushPromises();
    expect(w.text()).toContain('Rien ici pour l\'instant');
    expect(w.find('[data-testid="home-empty"]').text()).toContain('Connectez-vous');
    w.unmount();
  });
});

describe('subscriptions page in French', () => {
  it('words headings, tabs, day groups and relative dates in French', async () => {
    useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
    const channels = [{ id: 'c1', title: 'One', avatar_url: null, subscribedAt: 1, videoCount: 12, newCount: 2, lastUploadDate: ymd(3), lastUploadAt: 1, categories: ['Gaming'] }];
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('$fetch', vi.fn(async (url: string, opts: any = {}) => {
      if (url === '/api/subscriptions/channels') return { channels };
      if (url === '/api/subscriptions/feed') return opts.params?.type === 'short' ? { videos: [], total: 0 } : { videos: [video('t1', { upload_date: ymd(0), isNew: true })], total: 1 };
      return {};
    }));
    const w = await mountSuspended(SubscriptionsPage, { route: { path: '/subscriptions' } });
    await flushPromises();
    expect(w.find('h1').text()).toBe('Abonnements');
    expect(w.find('[data-testid="subs-tab-latest"]').text()).toBe('Récents');
    expect(w.find('[data-testid="subs-tab-channels"]').text()).toContain('Chaînes');
    expect(w.find('[data-testid="chip-all"]').text()).toBe('Tout');
    expect(w.find('[data-testid="subs-day-today"] h2').text()).toBe('Aujourd\'hui');
    expect(w.find('[data-testid="subs-mark-all-seen"]').text()).toBe('Tout marquer comme vu');
    expect(w.find('[data-testid="new-dot"]').text()).toBe('Nouveau');
    w.unmount();
    clearNuxtData();
    const w2 = await mountSuspended(SubscriptionsPage, { route: { path: '/subscriptions', query: { tab: 'channels' } } });
    await flushPromises();
    const card = w2.find('[data-testid="sub-channel-c1"]');
    expect(card.text()).toContain('12 vidéos');
    expect(card.text().replace(/\s/g, ' ')).toContain('Dernière mise en ligne il y a 3 jours');
    expect(card.find('[data-testid="sub-channel-new"]').text()).toBe('2 nouveaux');
    expect(card.find('[data-testid="sub-channel-unsubscribe"]').text()).toBe('Se désabonner');
    w2.unmount();
  });
});

describe('channels directory in French', () => {
  it('words the toolbar, counts and subscribe buttons in French', async () => {
    useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
    await useRouter().replace('/channels');
    vi.stubGlobal('$fetch', vi.fn(async (url: string, opts: any = {}) => {
      if (url === '/api/channels' && opts.params?.page) return { channels: [{ id: 'a', title: 'Alpha', avatar_url: null, completed_count: 1234, categories: ['Gaming'], subscribed: false, new_count: 0 }], total: 1 };
      if (url === '/api/channels/categories') return { categories: [{ name: 'Gaming', count: 1200 }] };
      if (url === '/api/channels/discover') return { channels: [] };
      return { channels: [] };
    }));
    const w = await mountSuspended(ChannelsPage, { route: '/channels' });
    await flushPromises();
    expect(w.find('h1').text()).toBe('Chaînes');
    expect(w.find('[data-testid="dir-total"]').text()).toBe('1 chaîne');
    expect(w.find('[data-testid="dir-search"]').attributes('placeholder')).toBe('Rechercher des chaînes');
    expect(w.find('[data-testid="dir-sort"] option[value="title"]').text()).toBe('Nom (A–Z)');
    expect(w.find('[data-testid="dir-following"] option[value="1"]').text()).toBe('Abonné');
    expect(w.find('[data-testid="category-chip-all"]').text()).toBe('Tout');
    const card = w.find('[data-testid="dir-channel-a"]');
    expect(card.text().replace(/\s/g, ' ')).toContain('1 234 vidéos');
    expect(card.find('[data-testid="dir-channel-subscribe"]').text()).toBe('S\'abonner');
    w.unmount();
  });

  it('says the channel is missing in French', async () => {
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/channels/nope')) throw Object.assign(new Error('nf'), { statusCode: 404, status: 404 });
      return { channels: [] };
    }));
    const w = await mountSuspended(ChannelsPage, { route: '/channels?channelId=nope' });
    await flushPromises();
    expect(w.find('[data-testid="channel-not-found"]').text()).toContain('Chaîne introuvable');
    w.unmount();
  });
});

describe('search page in French', () => {
  it('words the section titles and empty states in French', async () => {
    useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
    vi.stubGlobal('$fetch', vi.fn(async () => ({ videos: [], tracks: [], episodes: [] })));
    const w = await mountSuspended(SearchPage, { route: { path: '/search', query: { q: 'jazz' } } });
    await flushPromises();
    expect(w.find('h1').text()).toBe('Résultats pour « jazz »');
    expect(w.find('[data-testid="search-videos"]').text()).toContain('Aucune vidéo');
    expect(w.text()).toContain('Aucun titre');
    expect(w.text()).toContain('Aucun épisode');
    w.unmount();
  });
});
