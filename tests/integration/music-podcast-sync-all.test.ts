import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../server/utils/musicDownloader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/utils/musicDownloader')>()),
  syncAllMusicArtists: vi.fn(async () => {}),
}));
vi.mock('../../server/utils/podcastDownloader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/utils/podcastDownloader')>()),
  syncAllPodcastShows: vi.fn(async () => {}),
}));

import Database from 'better-sqlite3';
import musicSyncAll from '../../server/api/admin/music/sync-all.post';
import podcastSyncAll from '../../server/api/admin/podcasts/sync-all.post';
import { syncAllMusicArtists } from '../../server/utils/musicDownloader';
import { syncAllPodcastShows } from '../../server/utils/podcastDownloader';
import { requireAdmin } from '../../server/utils/auth';
import { createTestDb, insertUser, insertSession, insertSetting, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  vi.mocked(syncAllMusicArtists).mockClear();
  vi.mocked(syncAllPodcastShows).mockClear();
});

function loginAs(id: string, role: 'admin' | 'user') {
  insertUser(db, { id, role });
  insertSession(db, { id: `sess-${id}`, userId: id });
  return sessionCookie(`sess-${id}`);
}

const cases = [
  { name: 'music', handler: musicSyncAll, fn: () => vi.mocked(syncAllMusicArtists), flag: 'music_sync_all_active' },
  { name: 'podcasts', handler: podcastSyncAll, fn: () => vi.mocked(syncAllPodcastShows), flag: 'podcast_sync_all_active' },
];

describe.each(cases)('POST /api/admin/$name/sync-all', ({ handler, fn, flag }) => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(handler(mockEvent(undefined, { method: 'POST' }))).rejects.toMatchObject({ statusCode: 401 });
    await expect(handler(mockEvent(loginAs('u1', 'user'), { method: 'POST' }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('starts the sync once when none is running', async () => {
    const res: any = await handler(mockEvent(loginAs('admin', 'admin'), { method: 'POST' }));
    expect(res.success).toBe(true);
    expect(fn()).toHaveBeenCalledTimes(1);
  });

  it('refuses while a sync of that type is already running', async () => {
    insertSetting(db, { key: flag, value: '1' });
    const res: any = await handler(mockEvent(loginAs('admin', 'admin'), { method: 'POST' }));
    expect(res.success).toBe(false);
    expect(fn()).not.toHaveBeenCalled();
  });
});
