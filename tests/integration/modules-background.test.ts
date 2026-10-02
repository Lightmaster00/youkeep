import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runSyncAllEntities } from '../../server/utils/concurrency';
import { createTestDb, insertSetting } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  insertSetting(db, { key: 'music_sync_all_active', value: '0' });
  insertSetting(db, { key: 'music_downloader_paused', value: '0' });
});

const value = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;

function makeConfig(overrides: Record<string, any> = {}) {
  const calls = { fetch: vi.fn(), process: vi.fn(), onStart: vi.fn(), onPaused: vi.fn(), onComplete: vi.fn(), onFatal: vi.fn(), startWorker: vi.fn() };
  const config = {
    db,
    activeFlagSettingKey: 'music_sync_all_active',
    pausedSettingKey: 'music_downloader_paused',
    moduleId: 'music' as const,
    fetchEntities: () => { calls.fetch(); return [{ id: 'a' }, { id: 'b' }]; },
    processEntity: async (e: { id: string }) => { calls.process(e.id); },
    onStart: calls.onStart,
    onPaused: calls.onPaused,
    onComplete: calls.onComplete,
    onFatalError: calls.onFatal,
    startWorker: calls.startWorker,
    ...overrides,
  };
  return { config, calls };
}

describe('runSyncAllEntities with a moduleId', () => {
  it('runs normally when the module is enabled', async () => {
    const { config, calls } = makeConfig();
    await runSyncAllEntities(config);
    expect(calls.process).toHaveBeenCalledTimes(2);
    expect(calls.onComplete).toHaveBeenCalled();
    expect(value('music_sync_all_active')).toBe('0');
  });

  it('returns immediately when the module is disabled: nothing fetched, flag never raised', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const { config, calls } = makeConfig();
    await runSyncAllEntities(config);
    expect(calls.fetch).not.toHaveBeenCalled();
    expect(calls.process).not.toHaveBeenCalled();
    expect(calls.onComplete).not.toHaveBeenCalled();
    expect(calls.startWorker).not.toHaveBeenCalled();
    expect(value('music_sync_all_active')).toBe('0');
  });

  it('never touches the admin pause flag, whatever the module state', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await runSyncAllEntities(makeConfig().config);
    expect(value('music_downloader_paused')).toBe('0');
  });

  it('stops like a pause when the module gets disabled in the middle of the loop', async () => {
    const { config, calls } = makeConfig({
      processEntity: async (e: { id: string }) => {
        calls.process(e.id);
        db.prepare("INSERT INTO settings (key, value) VALUES ('music_module_enabled', '0') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
      },
    });
    await runSyncAllEntities(config);
    expect(calls.process).toHaveBeenCalledTimes(1);
    expect(calls.onPaused).toHaveBeenCalledTimes(1);
    expect(value('music_sync_all_active')).toBe('0');
  });

  it('keeps honouring the admin pause flag as before', async () => {
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'music_downloader_paused'").run();
    const { config, calls } = makeConfig();
    await runSyncAllEntities(config);
    expect(calls.process).not.toHaveBeenCalled();
    expect(calls.onPaused).toHaveBeenCalledTimes(1);
  });

  it('behaves exactly as before when no moduleId is given (backwards compatible)', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const { config, calls } = makeConfig({ moduleId: undefined });
    await runSyncAllEntities(config);
    expect(calls.process).toHaveBeenCalledTimes(2);
  });
});
