import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import videosHandler from '../../server/api/videos/index.get';
import { getUserFromSession } from '../../server/utils/auth';
import { assertInTmp, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';

// GET /api/videos?type=video|short|all: long videos and Shorts are kept
// apart; every list without an explicit type is long videos only.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-videos-type-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
  insertChannel(db, { id: 'ch' });
  insertVideo(db, { id: 'long1', channelId: 'ch', title: 'Cooking long', uploadDate: '20240101' });
  insertVideo(db, { id: 'long2', channelId: 'ch', title: 'Cooking again', uploadDate: '20240201' });
  insertVideo(db, { id: 'short1', channelId: 'ch', title: 'Cooking short', uploadDate: '20240301', isShort: true });
});

const list = async (query: string) => {
  const r = (await videosHandler(mockEvent(undefined, { path: `/api/videos?${query}` }))) as any;
  return { ids: r.videos.map((v: any) => v.id).sort(), total: r.pagination.total };
};

describe('GET /api/videos type', () => {
  it('a default list (feed, search, subscriptions, a channel) has no Shorts', async () => {
    expect((await list('')).ids).toEqual(['long1', 'long2']);
    expect((await list('q=cooking')).ids).toEqual(['long1', 'long2']);
    expect((await list('channelId=ch&sort=date_desc')).ids).toEqual(['long1', 'long2']);
    expect((await list('channelId=ch')).total).toBe(2);
  });

  it('type=short returns only Shorts, type=video only long videos, type=all both', async () => {
    expect((await list('type=short')).ids).toEqual(['short1']);
    expect((await list('type=short&q=cooking')).ids).toEqual(['short1']);
    expect((await list('type=video&channelId=ch')).ids).toEqual(['long1', 'long2']);
    expect(await list('type=all&channelId=ch')).toEqual({ ids: ['long1', 'long2', 'short1'], total: 3 });
  });

  it('keeps the legacy is_short parameter working', async () => {
    expect((await list('is_short=1')).ids).toEqual(['short1']);
    expect((await list('is_short=true')).ids).toEqual(['short1']);
    expect((await list('is_short=0')).ids).toEqual(['long1', 'long2']);
    expect((await list('is_short=all')).ids).toEqual(['long1', 'long2', 'short1']);
  });

  it('type wins over is_short when both are given', async () => {
    expect((await list('type=short&is_short=0')).ids).toEqual(['short1']);
  });

  it.each(['shorts', 'VIDEO', '1', 'video,short'])('rejects type=%s with a 400', async (type) => {
    await expect(list(`type=${encodeURIComponent(type)}`)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a repeated type parameter with a 400', async () => {
    await expect(list('type=video&type=short')).rejects.toMatchObject({ statusCode: 400 });
  });
});
