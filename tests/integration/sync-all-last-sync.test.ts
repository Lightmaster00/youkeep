import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runSyncAllEntities } from '../../server/utils/concurrency';
import { markShuttingDown } from '../../server/utils/processTree';
import { createTestDb, insertSetting } from '../helpers/testDb';

// The sync-all runner records when a run started and when it finished, per
// type: the Settings status and the startup catch-up read these.
let db: Database.Database;
const value = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  db = createTestDb();
  insertSetting(db, { key: 'podcast_sync_all_active', value: '0' });
  insertSetting(db, { key: 'podcast_downloader_paused', value: '0' });
});
afterEach(() => {
  vi.useRealTimers();
  markShuttingDown(false);
});

function config(overrides: Record<string, any> = {}) {
  return {
    db,
    activeFlagSettingKey: 'podcast_sync_all_active',
    pausedSettingKey: 'podcast_downloader_paused',
    moduleId: 'podcasts' as const,
    syncType: 'podcast' as const,
    fetchEntities: () => [{ id: 'a' }, { id: 'b' }],
    processEntity: async () => { vi.setSystemTime(new Date('2026-10-23T12:05:00Z')); },
    onStart: () => {},
    onPaused: () => {},
    onComplete: () => {},
    onFatalError: () => {},
    startWorker: () => {},
    ...overrides,
  };
}

describe('runSyncAllEntities last-sync bookkeeping', () => {
  it('stores the start and the end of a run', async () => {
    await runSyncAllEntities(config());
    expect(value('podcast_last_sync_started_at')).toBe(String(Date.parse('2026-10-23T12:00:00Z')));
    expect(value('podcast_last_sync_at')).toBe(String(Date.parse('2026-10-23T12:05:00Z')));
  });

  it('counts a run where some sources failed (processEntity swallows their errors) as finished', async () => {
    await runSyncAllEntities(config({ processEntity: async (e: { id: string }) => { if (e.id === 'a') return; } }));
    expect(value('podcast_last_sync_at')).toBeDefined();
  });

  it('records no finish for a fatal error or a shutdown, and nothing at all for a disabled module', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runSyncAllEntities(config({ fetchEntities: () => { throw new Error('boom'); } }));
    expect(value('podcast_last_sync_started_at')).toBeDefined();
    expect(value('podcast_last_sync_at')).toBeUndefined();

    markShuttingDown(true);
    await runSyncAllEntities(config());
    expect(value('podcast_last_sync_at')).toBeUndefined();
    markShuttingDown(false);

    db.prepare("DELETE FROM settings WHERE key = 'podcast_last_sync_started_at'").run();
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    await runSyncAllEntities(config());
    expect(value('podcast_last_sync_started_at')).toBeUndefined();
  });

  it('records nothing without a syncType', async () => {
    await runSyncAllEntities(config({ syncType: undefined }));
    expect(value('podcast_last_sync_at')).toBeUndefined();
  });
});
