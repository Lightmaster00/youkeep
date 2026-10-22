import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { assertInTmp } from '../helpers/testDb';

// The real database init path: a new install, and an existing install that
// predates the auto_sync_default_v1 migration.
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let dbFile: string;
const open: Database.Database[] = [];
const openDb = () => { const db = openDatabase(dbFile); open.push(db); return db; };
const get = (db: Database.Database, key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-autosync-'));
  assertInTmp(dir);
  dbFile = path.join(dir, 'youkeep.db');
});
afterEach(() => {
  for (const db of open.splice(0)) { try { db.close(); } catch {} }
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('automatic sync defaults on the real init path', () => {
  it('a new install has the three schedules on, every 6 hours', () => {
    const db = openDb();
    expect(get(db, 'sync_cron_enabled')).toBe('1');
    expect(get(db, 'sync_cron_schedule')).toBe('0 */6 * * *');
    expect(get(db, 'music_sync_cron_enabled')).toBe('1');
    expect(get(db, 'music_sync_cron_schedule')).toBe('30 */6 * * *');
    expect(get(db, 'podcast_sync_cron_enabled')).toBe('1');
    expect(get(db, 'podcast_sync_cron_schedule')).toBe('45 */6 * * *');
  });

  it('an existing install is migrated once (custom schedule kept), and a later disable survives a restart', () => {
    let db = openDb();
    // As an older version left it: everything off, the old defaults, one custom schedule, no flag.
    db.prepare("UPDATE settings SET value = '0' WHERE key IN ('sync_cron_enabled', 'music_sync_cron_enabled', 'podcast_sync_cron_enabled')").run();
    db.prepare("UPDATE settings SET value = '0 3 * * *' WHERE key = 'sync_cron_schedule'").run();
    db.prepare("UPDATE settings SET value = '0 5 * * 1' WHERE key = 'podcast_sync_cron_schedule'").run();
    db.prepare("DELETE FROM settings WHERE key = 'auto_sync_default_v1'").run();
    db.close();

    db = openDb();
    expect(get(db, 'sync_cron_enabled')).toBe('1');
    expect(get(db, 'sync_cron_schedule')).toBe('0 */6 * * *');
    expect(get(db, 'podcast_sync_cron_enabled')).toBe('1');
    expect(get(db, 'podcast_sync_cron_schedule')).toBe('0 5 * * 1');

    db.prepare("UPDATE settings SET value = '0' WHERE key = 'music_sync_cron_enabled'").run();
    db.close();
    db = openDb();
    expect(get(db, 'music_sync_cron_enabled')).toBe('0');
  });
});
