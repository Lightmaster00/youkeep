import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import optionsHandler from '../../server/api/admin/channels/[id]/options.put';
import { upsertIngestedChannel } from '../../server/utils/downloader';
import { createTestDb, insertChannel, mockEvent } from '../helpers/testDb';

vi.mock('../../server/utils/db', () => ({ getDb: () => (globalThis as any).getDb() }));

let db: Database.Database;
const savePath = (id: string) => (db.prepare('SELECT custom_save_path FROM channels WHERE id = ?').get(id) as any).custom_save_path;
const row = (id: string, customSavePath: string | null) => ({
  id, title: 'Chan', description: '', avatarUrl: null, bannerUrl: null, syncStatus: 'paused', visibility: 'public',
  downloadVideos: 1, downloadShorts: 0, downloadLives: 0, dateAfter: null, customSavePath,
});

beforeEach(() => {
  db = createTestDb();
  // The shared test schema has only the columns most tests need; add the follow options ones.
  for (const col of ['description TEXT', 'banner_url TEXT', 'download_videos INTEGER DEFAULT 1', 'download_shorts INTEGER DEFAULT 0',
    'download_lives INTEGER DEFAULT 0', 'date_after TEXT', "sync_status TEXT DEFAULT 'paused'"]) db.exec(`ALTER TABLE channels ADD COLUMN ${col}`);
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = async () => ({ id: 'admin', role: 'admin' });
});

describe('channel save path on follow', () => {
  it('is set when a channel is first followed, kept when it is followed again, and changed only by the options route', async () => {
    expect(upsertIngestedChannel(db, row('new', '/data/videos'), {})).toEqual({ savePathKept: false });
    expect(savePath('new')).toBe('/data/videos');
    expect(upsertIngestedChannel(db, row('new', '/data/videos'), {})).toEqual({ savePathKept: false }); // same folder again

    insertChannel(db, { id: 'old', title: 'Chan', customSavePath: '/data/videos/Chan' });
    expect(upsertIngestedChannel(db, row('old', '/data/videos'), { sync_status: 'downloading' })).toEqual({ savePathKept: true });
    expect(savePath('old')).toBe('/data/videos/Chan');
    expect((db.prepare('SELECT sync_status FROM channels WHERE id = ?').get('old') as any).sync_status).toBe('downloading');

    await optionsHandler(mockEvent('', { method: 'PUT', params: { id: 'old' }, body: { downloadVideos: true, customSavePath: '/mnt/yt' } }));
    expect(savePath('old')).toBe('/mnt/yt');
  });
});
