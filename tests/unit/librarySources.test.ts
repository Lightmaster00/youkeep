import { describe, it, expect } from 'vitest';
import {
  musicSource, podcastsSource, defaultFollowOptions, youtubeChannelUrl, youtubeDirectTarget,
  feedDirectTarget, visibilityLabel, plural,
} from '../../app/utils/librarySources';

describe('youtubeChannelUrl', () => {
  it('prefers the handle when asked', () => {
    expect(youtubeChannelUrl({ handle: '/@artist', id: 'UC1' }, 'handle')).toBe('https://www.youtube.com/@artist');
    expect(youtubeChannelUrl({ handle: '@artist' }, 'handle')).toBe('https://www.youtube.com/@artist');
  });
  it('prefers the id when asked', () => {
    expect(youtubeChannelUrl({ handle: '/@artist', id: 'UC1' }, 'id')).toBe('https://www.youtube.com/channel/UC1');
  });
  it('falls back to the other field, then to null', () => {
    expect(youtubeChannelUrl({ id: 'UC123' }, 'handle')).toBe('https://www.youtube.com/channel/UC123');
    expect(youtubeChannelUrl({ handle: '/@x' }, 'id')).toBe('https://www.youtube.com/@x');
    expect(youtubeChannelUrl({ id: '', handle: '' }, 'handle')).toBeNull();
  });
});

describe('direct targets', () => {
  it.each([
    ['https://www.youtube.com/@abc', 'https://www.youtube.com/@abc'],
    ['youtube.com/@abc', 'https://youtube.com/@abc'],
    ['www.youtube.com/channel/UC1', 'https://www.youtube.com/channel/UC1'],
    ['@abc', 'https://www.youtube.com/@abc'],
    ['  @abc  ', 'https://www.youtube.com/@abc'],
    ['Daft Punk', null],
    ['@two words', null],
    ['', null],
  ])('youtubeDirectTarget(%j) = %j', (q, expected) => {
    expect(youtubeDirectTarget(q)).toBe(expected);
  });

  it.each([
    ['https://feeds.example/show.xml', 'https://feeds.example/show.xml'],
    ['http://feeds.example/show.xml', 'http://feeds.example/show.xml'],
    ['Planet Money', null],
  ])('feedDirectTarget(%j) = %j', (q, expected) => {
    expect(feedDirectTarget(q)).toBe(expected);
  });
});

describe('musicSource', () => {
  it('builds the ingest body without visibility when it is left on "keep current"', () => {
    const o = defaultFollowOptions('music');
    expect(musicSource.buildIngestBody('https://www.youtube.com/@a', o, null)).toEqual({ url: 'https://www.youtube.com/@a', sync_status: 'downloading' });
  });
  it('sends paused and the visibility when chosen', () => {
    const o = { ...defaultFollowOptions('music'), autoSync: false, visibility: 'private' as const };
    expect(musicSource.buildIngestBody('u', o, null)).toEqual({ url: 'u', sync_status: 'paused', visibility: 'private' });
  });
  it('maps followed artists; only "downloading" counts as active', () => {
    const rows = musicSource.readFollowing({ artists: [
      { id: 'a1', name: 'One', avatar_url: 'x.jpg', sync_status: 'downloading', visibility: 'private', track_count: 3 },
      { id: 'a2', name: 'Two', avatar_url: null, sync_status: 'paused', visibility: null, track_count: 1 },
      { id: 'a3', name: 'Three', sync_status: 'active', visibility: 'public', track_count: 0 },
    ] });
    expect(rows).toEqual([
      { id: 'a1', name: 'One', imageUrl: 'x.jpg', countLabel: '3 tracks', syncActive: true, visibility: 'private', href: '/music?artistId=a1' },
      { id: 'a2', name: 'Two', imageUrl: '', countLabel: '1 track', syncActive: false, visibility: 'public', href: '/music?artistId=a2' },
      { id: 'a3', name: 'Three', imageUrl: '', countLabel: '0 tracks', syncActive: false, visibility: 'public', href: '/music?artistId=a3' },
    ]);
    expect(musicSource.readFollowing({})).toEqual([]);
  });
  it('uses the per-artist routes', () => {
    expect(musicSource.pauseUrl('a 1')).toBe('/api/admin/music/artists/a%201/pause');
    expect(musicSource.syncUrl('a1')).toBe('/api/admin/music/artists/a1/sync');
    expect(musicSource.syncAllEndpoint).toBe('/api/admin/music/sync-all');
    expect(musicSource.visibilityUrl).toBeNull();
  });
});

describe('podcastsSource', () => {
  it('follows by feed URL', () => {
    expect(podcastsSource.followTarget({ feedUrl: ' https://f/x.xml ' })).toBe('https://f/x.xml');
    expect(podcastsSource.followTarget({ feedUrl: '' })).toBeNull();
    expect(podcastsSource.buildIngestBody('https://f/x.xml', defaultFollowOptions('podcasts'), null)).toEqual({ feedUrl: 'https://f/x.xml', sync_status: 'downloading' });
  });
  it('maps followed shows', () => {
    expect(podcastsSource.readFollowing({ shows: [{ id: 's1', title: 'Show', cover_url: 'c.jpg', sync_status: 'downloading', visibility: 'public', episode_count: 2 }] })).toEqual([
      { id: 's1', name: 'Show', imageUrl: 'c.jpg', countLabel: '2 episodes', syncActive: true, visibility: 'public', href: '/podcasts?showId=s1' },
    ]);
  });
});

describe('helpers', () => {
  it('labels visibility and pluralises', () => {
    expect(visibilityLabel('ultra_private')).toBe('Ultra private');
    expect(visibilityLabel('weird')).toBe('weird');
    expect(plural(1, 'track')).toBe('1 track');
    expect(plural(2, 'track')).toBe('2 tracks');
  });
  it('defaults match the old forms', () => {
    expect(defaultFollowOptions('music')).toMatchObject({ autoSync: true, visibility: '' });
    expect(defaultFollowOptions('videos')).toMatchObject({ autoSync: true, visibility: 'public', downloadVideos: true, downloadShorts: false, downloadLives: false, dateAfter: '', saveFolder: '/downloads/videos' });
  });
});
