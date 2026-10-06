import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import DownloadQueueCard from '../../app/components/settings/DownloadQueueCard.vue';
import DownloadQueueList from '../../app/components/settings/DownloadQueueList.vue';
import type { QueueItem } from '../../app/utils/allDownloads';

const item = (over: Partial<QueueItem>): QueueItem => ({
  kind: 'video', id: 'v1', title: 'A video', source: 'Chan', status: 'pending',
  progress: 0, speed: null, eta: null, lastError: null, ...over,
});

describe('DownloadQueueCard', () => {
  it('shows the type pill, title, source and the Queued status', async () => {
    const w = await mountSuspended(DownloadQueueCard, { props: { item: item({}), progress: 0 } });
    expect(w.text()).toContain('Video');
    expect(w.text()).toContain('A video');
    expect(w.text()).toContain('Chan');
    expect(w.find('[data-testid="queue-item-status"]').text()).toBe('Queued');
  });

  it('shows progress, speed and ETA while downloading', async () => {
    const w = await mountSuspended(DownloadQueueCard, {
      props: { item: item({ kind: 'music', status: 'downloading', speed: '2MiB/s', eta: '00:30' }), progress: 41.6 },
    });
    expect(w.text()).toContain('42%');
    expect(w.text()).toContain('Speed: 2MiB/s');
    expect(w.text()).toContain('ETA: 00:30');
    expect(w.find('[data-testid="queue-item-status"]').text()).toBe('Downloading');
  });

  it('shows the error of a failed item', async () => {
    const w = await mountSuspended(DownloadQueueCard, { props: { item: item({ kind: 'podcast', status: 'failed', lastError: 'HTTP 404' }), progress: 0 } });
    expect(w.text()).toContain('Error: HTTP 404');
    expect(w.find('[data-testid="queue-item-status"]').text()).toBe('Failed');
  });

  it('offers the actions of each type and emits them', async () => {
    const v = await mountSuspended(DownloadQueueCard, { props: { item: item({}), progress: 0 } });
    expect(v.findAll('[data-testid^="queue-action-"]').map((b: any) => b.text())).toEqual(['Prioritize', 'Cancel']);
    await v.find('[data-testid="queue-action-prioritize"]').trigger('click');
    expect(v.emitted('action')).toEqual([['prioritize']]);

    const p = await mountSuspended(DownloadQueueCard, { props: { item: item({ kind: 'podcast', status: 'pending' }), progress: 0 } });
    expect(p.findAll('[data-testid^="queue-action-"]')).toHaveLength(0);
  });
});

describe('DownloadQueueList', () => {
  it('shows "Nothing is downloading" when empty', async () => {
    const w = await mountSuspended(DownloadQueueList, { props: { items: [], progressFor: () => 0 } });
    expect(w.find('[data-testid="queue-empty"]').text()).toContain('Nothing is downloading');
  });

  it('renders one card per item, in order, and forwards actions with the item', async () => {
    const items = [item({ kind: 'music', id: 'm1', status: 'downloading' }), item({ id: 'v1' })];
    const w = await mountSuspended(DownloadQueueList, { props: { items, progressFor: (i: QueueItem) => (i.id === 'm1' ? 77 : 0) } });
    expect(w.findAll('[data-testid^="queue-item-"]').filter((c: any) => c.attributes('data-testid') !== 'queue-item-status').map((c: any) => c.attributes('data-testid')))
      .toEqual(['queue-item-music-m1', 'queue-item-video-v1']);
    expect(w.find('[data-testid="queue-item-music-m1"]').text()).toContain('77%');
    await w.find('[data-testid="queue-item-music-m1"] [data-testid="queue-action-cancel"]').trigger('click');
    expect(w.emitted('action')![0]).toEqual([items[0], 'cancel']);
  });
});
