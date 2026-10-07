import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const wipe = vi.hoisted(() => ({ on: false }));
vi.mock('../../server/utils/libraryWipe', () => ({ isWipeInProgress: () => wipe.on }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import previewHandler from '../../server/api/admin/library/tidy/preview.post';
import startHandler from '../../server/api/admin/library/tidy/start.post';
import statusHandler from '../../server/api/admin/library/tidy/status.get';
import cancelHandler from '../../server/api/admin/library/tidy/cancel.post';
import { requireAdmin } from '../../server/utils/auth';
import { createTestDb, insertChannel, insertSession, insertUser, insertVideo, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-tidy-api-'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).getDownloadsDir = () => dir;
  (globalThis as any).requireAdmin = requireAdmin;
  wipe.on = false;
  insertChannel(db, { id: 'c1', title: 'Chan' });
  insertVideo(db, { id: 'v1', channelId: 'c1', title: 'One', localVideoPath: '/downloads/Chan/v1.mp4' });
  fs.mkdirSync(path.join(dir, 'Chan'));
  fs.writeFileSync(path.join(dir, 'Chan', 'v1.mp4'), 'x');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function login(id: string, role: 'admin' | 'user') {
  insertUser(db, { id, role });
  insertSession(db, { id: `sess-${id}`, userId: id });
  return sessionCookie(`sess-${id}`);
}
const post = (cookie?: string) => mockEvent(cookie, { method: 'POST', body: {} });

async function waitUntilIdle(cookie: string) {
  for (let i = 0; i < 200; i++) {
    const s = await statusHandler(mockEvent(cookie));
    if (s.state !== 'running') return s;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('tidy run did not finish');
}

describe('/api/admin/library/tidy', () => {
  it('is admin only, for every route', async () => {
    const user = login('u1', 'user');
    for (const handler of [previewHandler, startHandler, cancelHandler]) {
      await expect(handler(post())).rejects.toMatchObject({ statusCode: 401 });
      await expect(handler(post(user))).rejects.toMatchObject({ statusCode: 403 });
    }
    await expect(statusHandler(mockEvent())).rejects.toMatchObject({ statusCode: 401 });
    await expect(statusHandler(mockEvent(user))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('previews, runs once at a time, reports, and refuses during a library wipe', async () => {
    const admin = login('a1', 'admin');
    expect(await previewHandler(post(admin))).toMatchObject({ total: 1, toMove: 1 });

    expect(await startHandler(post(admin))).toEqual({ started: true });
    await expect(startHandler(post(admin))).rejects.toMatchObject({ statusCode: 409 });
    expect(await waitUntilIdle(admin)).toMatchObject({ state: 'done', moved: 1 });
    expect(await cancelHandler(post(admin))).toEqual({ cancelling: false });

    wipe.on = true;
    await expect(startHandler(post(admin))).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringContaining('library wipe') });
  });
});
