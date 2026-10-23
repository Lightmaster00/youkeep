import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import statusHandler from '../../server/api/admin/system/metadata-backfill/status.get';
import startHandler from '../../server/api/admin/system/metadata-backfill/start.post';
import settingsHandler from '../../server/api/admin/system/metadata-backfill/settings.post';
import { cancelMetadataBackfill, isMetadataBackfillRunning, metadataBackfillDeps } from '../../server/utils/metadataBackfill';
import { createApiToken } from '../../server/utils/apiTokens';
import { createTestDb, insertChannel, insertSession, insertUser, insertVideo, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
const realDeps = { ...metadataBackfillDeps };
let release: (() => void) | null;
let requested: number;

function login(id: string, role: 'admin' | 'user') {
  insertUser(db, { id, role });
  insertSession(db, { id: `sess-${id}`, userId: id });
  return sessionCookie(`sess-${id}`);
}
const post = (cookie?: string, body: any = {}, headers?: Record<string, string>) => mockEvent(cookie, { method: 'POST', body, headers });

async function waitIdle() {
  for (let i = 0; i < 400; i++) {
    if (!isMetadataBackfillRunning()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('the backfill did not finish');
}

beforeEach(async () => {
  await waitIdle();
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  release = null;
  requested = 0;
  metadataBackfillDeps.sleep = async () => {};
  metadataBackfillDeps.isShuttingDown = () => false;
  metadataBackfillDeps.blockedReason = () => null;
  metadataBackfillDeps.runYtdl = async () => {
    requested++;
    await new Promise<void>((r) => { release = r; });
    return { stdout: JSON.stringify({ categories: ['Gaming'] }), stderr: '', status: 0 };
  };
  insertChannel(db, { id: 'c1' });
  insertVideo(db, { id: 'videoAAAA01', channelId: 'c1', createdAt: 2 });
  insertVideo(db, { id: 'videoBBBB01', channelId: 'c1', createdAt: 1, metadataEnrichedAt: 1 });
});

afterEach(async () => {
  cancelMetadataBackfill();
  release?.();
  await waitIdle();
  Object.assign(metadataBackfillDeps, realDeps);
});

describe('/api/admin/system/metadata-backfill', () => {
  it('is for admins with a browser session only, for every route', async () => {
    const user = login('u1', 'user');
    login('ad', 'admin');
    const token = createApiToken('ad', 'Script').token;
    const bearer = { authorization: `Bearer ${token}` };
    for (const handler of [startHandler, settingsHandler]) {
      await expect(handler(post(undefined, { enabled: true }))).rejects.toMatchObject({ statusCode: 401 });
      await expect(handler(post(user, { enabled: true }))).rejects.toMatchObject({ statusCode: 403 });
      await expect(handler(post(undefined, { enabled: true }, bearer))).rejects.toMatchObject({ statusCode: 403 });
    }
    await expect(statusHandler(mockEvent())).rejects.toMatchObject({ statusCode: 401 });
    await expect(statusHandler(mockEvent(user))).rejects.toMatchObject({ statusCode: 403 });
    await expect(statusHandler(mockEvent(undefined, { headers: bearer }))).rejects.toMatchObject({ statusCode: 403 });
    expect(isMetadataBackfillRunning()).toBe(false);
  });

  it('reports counts and the run, and starts in the background', async () => {
    const admin = login('ad', 'admin');
    expect(await statusHandler(mockEvent(admin))).toMatchObject({ total: 2, enriched: 1, pending: 1, enabled: true, run: { state: 'idle' } });
    expect(await startHandler(post(admin))).toEqual({ started: true, alreadyRunning: false, pending: 1 });
    await expect.poll(() => requested).toBe(1);
    expect((await statusHandler(mockEvent(admin))).run).toMatchObject({ state: 'running', processed: 0 });
    expect(await startHandler(post(admin))).toMatchObject({ started: true, alreadyRunning: true });
    release!();
    await waitIdle();
    expect(await statusHandler(mockEvent(admin))).toMatchObject({ pending: 0, enriched: 2, run: { state: 'done', enriched: 1 } });
  });

  it('turns the lookup off and on; a start is refused while it is off', async () => {
    const admin = login('ad', 'admin');
    await expect(settingsHandler(post(admin, { enabled: 'no' }))).rejects.toMatchObject({ statusCode: 400 });
    expect(await settingsHandler(post(admin, { enabled: false }))).toEqual({ enabled: false });
    expect((await statusHandler(mockEvent(admin))).enabled).toBe(false);
    await expect(startHandler(post(admin))).rejects.toMatchObject({ statusCode: 409 });
    expect(await settingsHandler(post(admin, { enabled: true }))).toEqual({ enabled: true });
  });
});
