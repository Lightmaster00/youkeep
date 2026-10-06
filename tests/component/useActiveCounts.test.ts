import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useActiveCounts } from '../../app/composables/useActiveCounts';

const payload = {
  video: { downloading: 1, pending: 4 },
  music: { downloading: 2, pending: 0 },
  podcasts: { downloading: 0, pending: 3 },
  total: 10,
  current: { kind: 'video', progress: 12, speed: '1MiB/s' },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useState('admin_active_counts').value = null;
  fetchMock = vi.fn(async () => payload);
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('useActiveCounts', () => {
  it('starts empty with zero totals', () => {
    const { counts, downloadingTotal, queuedTotal } = useActiveCounts();
    expect(counts.value).toBeNull();
    expect(downloadingTotal.value).toBe(0);
    expect(queuedTotal.value).toBe(0);
  });

  it('loads the counts and sums downloading and queued across types', async () => {
    const { counts, downloadingTotal, queuedTotal, fetchActiveCounts } = useActiveCounts();
    await fetchActiveCounts();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/downloader/active-counts');
    expect(counts.value).toEqual(payload);
    expect(downloadingTotal.value).toBe(3);
    expect(queuedTotal.value).toBe(7);
  });

  it('keeps the last value when a refresh fails', async () => {
    const { counts, fetchActiveCounts } = useActiveCounts();
    await fetchActiveCounts();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await fetchActiveCounts();
    expect(counts.value).toEqual(payload);
  });
});
