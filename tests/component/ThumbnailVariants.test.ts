import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import VideoCard from '../../app/components/VideoCard.vue';
import MusicTrackCard from '../../app/components/MusicTrackCard.vue';
import PodcastEpisodeCard from '../../app/components/PodcastEpisodeCard.vue';
import MusicAlbumTile from '../../app/components/MusicAlbumTile.vue';
import MusicArtistTile from '../../app/components/MusicArtistTile.vue';
import MusicTrackList from '../../app/components/MusicTrackList.vue';

beforeEach(() => {
  vi.stubGlobal('$fetch', vi.fn(async () => ({})));
});
afterEach(() => vi.unstubAllGlobals());

const imgOf = (w: any, selector = 'img') => w.find(selector).element as HTMLImageElement;
const srcOf = (w: any, selector = 'img') => imgOf(w, selector).getAttribute('src');

describe('cards ask for a resized thumbnail', () => {
  it('VideoCard: 480 px, lazy, async decoding, intrinsic size', async () => {
    const video = { id: 'v1', title: 'T', duration: 60, view_count: 1, upload_date: null, local_thumbnail_path: '/downloads/Chan/T%20%5Bv1%5D/T%20%5Bv1%5D.jpg' };
    const w = await mountSuspended(VideoCard, { props: { video } });
    const img = imgOf(w, '.thumbnail-img');
    expect(img.getAttribute('src')).toBe('/downloads/Chan/T%20%5Bv1%5D/T%20%5Bv1%5D.jpg?w=480');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['480', '270']);

    const remote = await mountSuspended(VideoCard, { props: { video: { ...video, id: 'v2', local_thumbnail_path: undefined } } });
    expect(srcOf(remote, '.thumbnail-img')).toBe('https://i.ytimg.com/vi/v2/hqdefault.jpg');
  });

  it('track, episode, album and artist tiles: 320 px', async () => {
    const track = await mountSuspended(MusicTrackCard, { props: { track: { id: 't1', title: 'S', local_thumbnail_path: '/downloads-music/A/t1.webp' } } });
    expect(srcOf(track)).toBe('/downloads-music/A/t1.webp?w=320');
    expect(imgOf(track).getAttribute('decoding')).toBe('async');

    const external = await mountSuspended(MusicTrackCard, { props: { track: { id: 't2', title: 'S', album_cover_url: 'https://is1-ssl.mzstatic.com/x/600x600bb.jpg' } } });
    expect(srcOf(external)).toBe('https://is1-ssl.mzstatic.com/x/600x600bb.jpg');

    const episode = await mountSuspended(PodcastEpisodeCard, { props: { episode: { id: 'e1', title: 'E', local_thumbnail_path: '/downloads-podcasts/S/e1.jpg' } } });
    expect(srcOf(episode)).toBe('/downloads-podcasts/S/e1.jpg?w=320');

    const album = await mountSuspended(MusicAlbumTile, { props: { album: { id: 'al1', title: 'Al', cover_url: '/downloads-music/A/t1.jpg' } } });
    expect(srcOf(album)).toBe('/downloads-music/A/t1.jpg?w=320');

    const artist = await mountSuspended(MusicArtistTile, { props: { artist: { id: 'a1', name: 'A', avatar_url: 'https://yt3.ggpht.com/a.jpg' } } });
    expect(srcOf(artist)).toBe('https://yt3.ggpht.com/a.jpg');
  });

  it('track list rows: 160 px', async () => {
    const w = await mountSuspended(MusicTrackList, {
      props: { tracks: [{ id: 't1', title: 'S', local_thumbnail_path: '/downloads-music/A/t1.jpg' }, { id: 't2', title: 'R', album_cover_url: 'https://x.example/c.jpg' }] },
    });
    const srcs = w.findAll('img.mtl-cover').map((i: any) => i.attributes('src'));
    expect(srcs).toEqual(['/downloads-music/A/t1.jpg?w=160', 'https://x.example/c.jpg']);
  });
});
