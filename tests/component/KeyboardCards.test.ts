import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import VideoCard from '../../app/components/VideoCard.vue';
import MusicTrackCard from '../../app/components/MusicTrackCard.vue';
import MusicTrackList from '../../app/components/MusicTrackList.vue';

const video = { id: 'vid1', title: 'A & B', duration: 61, view_count: 10, upload_date: '20240101', channel_title: 'C' };

afterEach(() => vi.restoreAllMocks());

describe('keyboard-operable cards', () => {
  it('VideoCard exposes a real link to the video in its title', async () => {
    const w = await mountSuspended(VideoCard, { props: { video } });
    const link = w.find('a.video-title-link');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('/watch/vid1');
    expect(link.text()).toBe('A & B');
  });

  it('VideoCard keeps the link (and highlight) for search results and honours `to`', async () => {
    const w = await mountSuspended(VideoCard, { props: { video, searchQuery: 'b', to: '/watch/vid1?playlistId=p1' } });
    const link = w.find('a.video-title-link');
    expect(link.attributes('href')).toBe('/watch/vid1?playlistId=p1');
    expect(link.html()).toContain('<mark>B</mark>');
  });

  it('VideoCard renders no link when not clickable', async () => {
    const w = await mountSuspended(VideoCard, { props: { video, clickable: false } });
    expect(w.find('a.video-title-link').exists()).toBe(false);
  });

  it('MusicTrackCard plays on Enter and Space', async () => {
    const track = { id: 't1', title: 'Song', local_file_path: '/a.mp3' };
    const w = await mountSuspended(MusicTrackCard, { props: { track } });
    const card = w.find('[role="button"]');
    expect(card.attributes('tabindex')).toBe('0');
    await card.trigger('keydown', { key: 'Enter' });
    await card.trigger('keydown', { key: ' ' });
    expect(w.emitted('play')).toHaveLength(2);
  });

  it('MusicTrackList rows play on Enter and Space', async () => {
    const tracks = [{ id: 't1', title: 'Song', local_file_path: '/a.mp3' }];
    const w = await mountSuspended(MusicTrackList, { props: { tracks } });
    const row = w.find('li.mtl-row');
    expect(row.attributes('role')).toBe('button');
    await row.trigger('keydown', { key: 'Enter' });
    await row.trigger('keydown', { key: ' ' });
    expect(w.emitted('play')).toHaveLength(2);
  });
});
