import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import videosHandler from '../../server/api/videos/index.get';
import { getUserFromSession } from '../../server/utils/auth';
import { assertInTmp, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';

// The channel page pages through a channel lazily, so its sort order (and the
// Shorts/videos split) has to come from the server, not from a client-side
// sort of a fully downloaded list.
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let db: Database.Database;
let dir: string;

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-videos-sort-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
  insertChannel(db, { id: 'ch' });
  insertVideo(db, { id: 'a', channelId: 'ch', uploadDate: '20240101', viewCount: 50, duration: 30 });
  insertVideo(db, { id: 'b', channelId: 'ch', uploadDate: '20240301', viewCount: 10, duration: 300 });
  insertVideo(db, { id: 'c', channelId: 'ch', uploadDate: '20240201', viewCount: 99, duration: 120 });
  insertVideo(db, { id: 's', channelId: 'ch', uploadDate: '20240401', viewCount: 1, duration: 20, isShort: true });
});

const ids = async (query: string) =>
  ((await videosHandler(mockEvent(undefined, { path: `/api/videos?channelId=ch&${query}` }))) as any).videos.map((v: any) => v.id);

describe('GET /api/videos sort', () => {
  it.each([
    ['date_desc', ['b', 'c', 'a']],
    ['date_asc', ['a', 'c', 'b']],
    ['views_desc', ['c', 'a', 'b']],
    ['views_asc', ['b', 'a', 'c']],
    ['duration_desc', ['b', 'c', 'a']],
    ['duration_asc', ['a', 'c', 'b']],
  ])('%s', async (sort, expected) => {
    expect(await ids(`is_short=0&sort=${sort}`)).toEqual(expected);
  });

  it('keeps Shorts apart with is_short=1', async () => {
    expect(await ids('is_short=1&sort=date_desc')).toEqual(['s']);
  });

  it('rejects an unknown sort with a 400', async () => {
    await expect(ids('sort=title;DROP')).rejects.toMatchObject({ statusCode: 400 });
  });
});
