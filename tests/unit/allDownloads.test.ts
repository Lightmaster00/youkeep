import { describe, it, expect } from 'vitest';
import {
  toQueueItem, mergeQueues, filterCounts, visibleQueue, capNotice, typeSummary, nextPollDelay,
  queueActionsFor, queueActionRequest, emptyTypeState, QUEUE_CAP,
  type QueueItem, type DownloadKind, type TypeQueueState,
} from '../../app/utils/allDownloads';

const item = (kind: DownloadKind, id: string, status: QueueItem['status']): QueueItem =>
  ({ kind, id, title: id, source: 's', status, progress: 0, speed: null, eta: null, lastError: null });

const state = (items: QueueItem[], extra: Partial<TypeQueueState> = {}): TypeQueueState =>
  ({ ...emptyTypeState(), items, total: items.length, ...extra });

describe('toQueueItem', () => {
  it('reads the source field of each type and normalises the status', () => {
    expect(toQueueItem('video', { id: 'v1', title: 'V', download_status: 'downloading', download_progress: 42.5, download_speed: '1MiB/s', download_eta: '00:10', channel_title: 'Chan' }))
      .toEqual({ kind: 'video', id: 'v1', title: 'V', source: 'Chan', status: 'downloading', progress: 42.5, speed: '1MiB/s', eta: '00:10', lastError: null });
    expect(toQueueItem('music', { id: 'm1', title: 'M', download_status: 'failed', last_error: 'x', artist_name: 'Art' }).source).toBe('Art');
    expect(toQueueItem('podcast', { id: 'p1', title: 'P', download_status: 'pending', show_title: 'Show' }).source).toBe('Show');
    expect(toQueueItem('music', { id: 'm2', download_status: 'weird' }).status).toBe('pending');
  });
});

describe('mergeQueues', () => {
  it('puts every downloading item first, then queued items interleaved by type, then failed', () => {
    const merged = mergeQueues({
      video: [item('video', 'v-p1', 'pending'), item('video', 'v-f1', 'failed'), item('video', 'v-p2', 'pending'), item('video', 'v-p3', 'pending')],
      music: [item('music', 'm-d1', 'downloading'), item('music', 'm-p1', 'pending')],
      podcast: [item('podcast', 'p-f1', 'failed'), item('podcast', 'p-p1', 'pending'), item('podcast', 'p-d1', 'downloading')],
    });
    expect(merged.map((i) => i.id)).toEqual([
      'm-d1', 'p-d1',
      'v-p1', 'm-p1', 'p-p1', 'v-p2', 'v-p3',
      'v-f1', 'p-f1',
    ]);
  });
});

describe('filterCounts / visibleQueue / capNotice', () => {
  const states = {
    video: state(Array.from({ length: 100 }, (_, i) => item('video', `v${i}`, 'pending')), { total: 150 }),
    music: state([item('music', 'm1', 'downloading')]),
    podcast: state([], { total: 0 }),
  };

  it('counts per type from the route totals and sums them for All', () => {
    expect(filterCounts(states)).toEqual({ all: 151, video: 150, music: 1, podcast: 0 });
  });

  it('caps the All view at 100 with downloading first and reports the full total', () => {
    const v = visibleQueue(states, 'all');
    expect(v.items).toHaveLength(QUEUE_CAP);
    expect(v.items[0]!.id).toBe('m1');
    expect(v.total).toBe(151);
    expect(capNotice(v.items.length, v.total)).toBe('Showing the first 100 of 151');
  });

  it('filters by type', () => {
    expect(visibleQueue(states, 'music').items.map((i) => i.id)).toEqual(['m1']);
    expect(visibleQueue(states, 'music').total).toBe(1);
    expect(visibleQueue(states, 'podcast').items).toEqual([]);
  });

  it('shows no notice when everything is visible', () => {
    expect(capNotice(3, 3)).toBeNull();
    expect(capNotice(0, 0)).toBeNull();
  });
});

describe('typeSummary / nextPollDelay', () => {
  it('derives downloading, queued and failed counts', () => {
    const s = state([item('video', 'a', 'downloading'), item('video', 'b', 'pending'), item('video', 'c', 'failed')], { total: 40, failedCount: 5 });
    expect(typeSummary(s)).toEqual({ downloading: 1, queued: 34, failed: 5 });
    expect(typeSummary(state([], { total: 0, failedCount: 2 }))).toEqual({ downloading: 0, queued: 0, failed: 2 });
  });

  it('polls every 500 ms while anything downloads, else every 3 s', () => {
    const idle = { video: state([item('video', 'a', 'pending')]), music: state([]), podcast: state([]) };
    expect(nextPollDelay(idle)).toBe(3000);
    expect(nextPollDelay({ ...idle, podcast: state([item('podcast', 'p', 'downloading')]) })).toBe(500);
  });
});

describe('queue actions', () => {
  it('offers Prioritize for queued videos, Cancel for videos and music, Retry for failed podcasts', () => {
    expect(queueActionsFor(item('video', 'v', 'pending'))).toEqual(['prioritize', 'cancel']);
    expect(queueActionsFor(item('video', 'v', 'downloading'))).toEqual(['cancel']);
    expect(queueActionsFor(item('music', 'm', 'failed'))).toEqual(['cancel']);
    expect(queueActionsFor(item('podcast', 'p', 'failed'))).toEqual(['retry']);
    expect(queueActionsFor(item('podcast', 'p', 'pending'))).toEqual([]);
  });

  it('maps each action to the existing route', () => {
    expect(queueActionRequest(item('video', 'v1', 'pending'), 'prioritize')).toEqual({ url: '/api/admin/downloader/prioritize', body: { videoId: 'v1' } });
    expect(queueActionRequest(item('video', 'v1', 'pending'), 'cancel')).toEqual({ url: '/api/admin/downloader/cancel', body: { videoId: 'v1' } });
    expect(queueActionRequest(item('music', 'm1', 'pending'), 'cancel')).toEqual({ url: '/api/admin/music/tracks/m1/cancel' });
    expect(queueActionRequest(item('podcast', 'p1', 'failed'), 'retry')).toEqual({ url: '/api/admin/podcasts/retry-failed', body: { episodeId: 'p1' } });
    expect(() => queueActionRequest(item('podcast', 'p1', 'pending'), 'cancel')).toThrow();
  });
});
