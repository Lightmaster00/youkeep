import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { assertInTmp } from '../helpers/testDb';
import { extractInfoFields, saveDownloadedVideo } from '../../server/utils/videoInfo';

// The row a finished download writes (real schema: size_bytes/like_count are real-only columns).
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-save-dl-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  db.prepare("INSERT INTO channels (id, title, created_at) VALUES ('c', 'C', 0)").run();
  db.prepare("INSERT INTO videos (id, title, channel_id, download_status, description, created_at) VALUES ('v', 'T', 'c', 'downloading', 'old', 0)").run();
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const row = () => db.prepare('SELECT * FROM videos WHERE id = ?').get('v') as any;

describe('saveDownloadedVideo', () => {
  it('stores categories and tags from the info.json and marks the video enriched', () => {
    const info = extractInfoFields({ description: 'new', categories: ['Gaming'], tags: ['Minecraft', 'Survival'], view_count: 10 });
    saveDownloadedVideo(db, 'v', { videoPath: '/downloads/v.mp4', thumbnailPath: '/downloads/v.jpg', sizeBytes: 5, info }, 1234);
    const r = row();
    expect(JSON.parse(r.categories)).toEqual(['Gaming']);
    expect(JSON.parse(r.tags)).toEqual(['minecraft', 'survival']);
    expect(r.metadata_enriched_at).toBe(1234);
    expect(r).toMatchObject({ description: 'new', view_count: 10, local_video_path: '/downloads/v.mp4', size_bytes: 5 });
  });

  it('an info.json without categories still marks the video enriched, with empty lists', () => {
    saveDownloadedVideo(db, 'v', { videoPath: null, thumbnailPath: null, sizeBytes: null, info: extractInfoFields({}) }, 99);
    expect(row()).toMatchObject({ categories: '[]', tags: '[]', metadata_enriched_at: 99, description: 'old' });
  });

  it('without an info.json the metadata stays unenriched (the backfill fills it later)', () => {
    db.prepare(`UPDATE videos SET categories = '["Music"]' WHERE id = 'v'`).run();
    saveDownloadedVideo(db, 'v', { videoPath: '/downloads/v.mp4', thumbnailPath: null, sizeBytes: null, info: null });
    expect(row()).toMatchObject({ categories: '["Music"]', tags: null, metadata_enriched_at: null, description: 'old' });
  });

  it('recomputes the channel categories when the info.json brought categories', () => {
    const channelCats = () => (db.prepare("SELECT categories FROM channels WHERE id = 'c'").get() as any).categories;
    db.prepare("UPDATE channels SET categories = NULL").run();
    saveDownloadedVideo(db, 'v', { videoPath: null, thumbnailPath: null, sizeBytes: null, info: null });
    expect(channelCats()).toBeNull();
    saveDownloadedVideo(db, 'v', { videoPath: null, thumbnailPath: null, sizeBytes: null, info: extractInfoFields({ categories: ['Gaming'] }) });
    expect(channelCats()).toBe('["Gaming"]');
  });
});
