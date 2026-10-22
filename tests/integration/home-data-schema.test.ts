import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { assertInTmp } from '../helpers/testDb';

// Data additions of the new home / subscriptions / recommendations (part 2A).
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let dbFile: string;
const open: Database.Database[] = [];

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-home-schema-'));
  assertInTmp(dir);
  dbFile = path.join(dir, 'youkeep.db');
});
afterEach(() => {
  for (const db of open.splice(0)) { try { db.close(); } catch {} }
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const cols = (db: Database.Database, table: string) =>
  new Map((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => [c.name, c]));

describe('home data schema', () => {
  it('adds categories, tags and metadata_enriched_at to videos', () => {
    const db = openDatabase(dbFile); open.push(db);
    const c = cols(db, 'videos');
    expect(c.get('categories')?.type).toBe('TEXT');
    expect(c.get('tags')?.type).toBe('TEXT');
    expect(c.get('metadata_enriched_at')?.type).toBe('INTEGER');
  });

  it('adds the resume position columns to user_history', () => {
    const db = openDatabase(dbFile); open.push(db);
    const c = cols(db, 'user_history');
    expect(c.get('position_seconds')).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    expect(c.get('duration_seconds')?.type).toBe('INTEGER');
    expect(c.get('position_updated_at')?.type).toBe('INTEGER');
  });

  it('creates user_seen_videos keyed by (user_id, video_id)', () => {
    const db = openDatabase(dbFile); open.push(db);
    const c = cols(db, 'user_seen_videos');
    expect(c.get('user_id')?.pk).toBe(1);
    expect(c.get('video_id')?.pk).toBe(2);
    expect(c.get('seen_at')?.notnull).toBe(1);
  });

  it('indexes videos(channel_id, upload_date)', () => {
    const db = openDatabase(dbFile); open.push(db);
    const info = db.prepare('PRAGMA index_info(idx_videos_channel_upload)').all() as any[];
    expect(info.map((r) => r.name)).toEqual(['channel_id', 'upload_date']);
  });

  it('migrates an older database idempotently, keeping its history rows', () => {
    const old = new Database(dbFile);
    old.exec(`
      CREATE TABLE user_history (user_id TEXT NOT NULL, video_id TEXT NOT NULL, watched_at INTEGER NOT NULL, PRIMARY KEY (user_id, video_id));
      INSERT INTO user_history (user_id, video_id, watched_at) VALUES ('u', 'v', 1);
    `);
    old.close();
    const db1 = openDatabase(dbFile); db1.close();
    const db = openDatabase(dbFile); open.push(db);
    expect(db.prepare('SELECT position_seconds, duration_seconds FROM user_history').get()).toEqual({ position_seconds: 0, duration_seconds: null });
  });
});
