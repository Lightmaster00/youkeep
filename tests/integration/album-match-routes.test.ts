import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import previewHandler from '../../server/api/admin/music/album-match/preview.post';
import startHandler from '../../server/api/admin/music/album-match/start.post';
import statusHandler from '../../server/api/admin/music/album-match/status.get';
import cancelHandler from '../../server/api/admin/music/album-match/cancel.post';
import settingsHandler from '../../server/api/admin/music/album-match/settings.post';
import { albumMatchDeps, cancelAlbumMatchRun, isAlbumMatchRunning } from '../../server/utils/albumMatchRunner';
import { createTestDb, insertMusicArtist, insertMusicTrack, insertSession, insertUser, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
const realDeps = { ...albumMatchDeps };
let release: (() => void) | null;
let searched: string[];

function login(id: string, role: 'admin' | 'user') {
  insertUser(db, { id, role });
  insertSession(db, { id: `sess-${id}`, userId: id });
  return sessionCookie(`sess-${id}`);
}
const post = (cookie?: string, body: any = {}) => mockEvent(cookie, { method: 'POST', body });

async function waitIdle() {
  for (let i = 0; i < 400; i++) {
    if (!isAlbumMatchRunning()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('album matching did not finish');
}

beforeEach(async () => {
  await waitIdle();
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  release = null;
  searched = [];
  albumMatchDeps.throttle = async () => {};
  albumMatchDeps.sleep = async () => {};
  albumMatchDeps.search = async (_artist, title) => {
    searched.push(title);
    await new Promise<void>((r) => { release = r; });
    return null;
  };
  insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
  insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'One', createdAt: 1 });
  insertMusicTrack(db, { id: 't2', artistId: 'a1', title: 'Two', createdAt: 2 });
  insertMusicTrack(db, { id: 'u1', artistId: 'a1', title: 'Old', albumMatchStatus: 'unmatched' });
});

afterEach(async () => {
  cancelAlbumMatchRun();
  release?.();
  await waitIdle();
  Object.assign(albumMatchDeps, realDeps);
});

describe('/api/admin/music/album-match', () => {
  it('is admin only, for every route', async () => {
    const user = login('u1', 'user');
    for (const handler of [previewHandler, startHandler, cancelHandler, settingsHandler]) {
      await expect(handler(post(undefined, { enabled: true }))).rejects.toMatchObject({ statusCode: 401 });
      await expect(handler(post(user, { enabled: true }))).rejects.toMatchObject({ statusCode: 403 });
    }
    await expect(statusHandler(mockEvent())).rejects.toMatchObject({ statusCode: 401 });
    await expect(statusHandler(mockEvent(user))).rejects.toMatchObject({ statusCode: 403 });
    expect(isAlbumMatchRunning()).toBe(false);
  });

  it('previews the counts', async () => {
    const admin = login('ad', 'admin');
    expect(await previewHandler(post(admin))).toEqual({ completedTracks: 3, unchecked: 2, matched: 0, unmatched: 1, manual: 0, enabled: true });
  });

  it('starts, reports progress, joins a second start, cancels', async () => {
    const admin = login('ad', 'admin');
    expect(await startHandler(post(admin, { scope: 'unchecked' }))).toMatchObject({ started: true, joined: false, queued: 2 });
    await expect.poll(() => searched.length).toBe(1);
    expect(await statusHandler(mockEvent(admin))).toMatchObject({ state: 'running', scope: 'unchecked', processed: 0, total: 2 });

    expect(await startHandler(post(admin, { scope: 'unmatched' }))).toMatchObject({ started: true, joined: true, queued: 1 });
    expect((await statusHandler(mockEvent(admin))).total).toBe(3);

    expect(await cancelHandler(post(admin))).toEqual({ cancelling: true });
    release!();
    await waitIdle();
    expect(await statusHandler(mockEvent(admin))).toMatchObject({ state: 'cancelled', processed: 1 });
    expect(await cancelHandler(post(admin))).toEqual({ cancelling: false });
  });

  it('defaults to the unchecked scope and rejects an unknown scope', async () => {
    const admin = login('ad', 'admin');
    await expect(startHandler(post(admin, { scope: 'everything' }))).rejects.toMatchObject({ statusCode: 400 });
    expect(await startHandler(post(admin))).toMatchObject({ started: true, queued: 2 });
  });

  it('retries unmatched tracks only with the unmatched scope', async () => {
    const admin = login('ad', 'admin');
    await startHandler(post(admin, { scope: 'unmatched' }));
    await expect.poll(() => searched).toEqual(['Old']);
  });

  it('turns matching off and on; a start is refused while it is off', async () => {
    const admin = login('ad', 'admin');
    await expect(settingsHandler(post(admin, { enabled: 'no' }))).rejects.toMatchObject({ statusCode: 400 });
    expect(await settingsHandler(post(admin, { enabled: false }))).toEqual({ enabled: false });
    expect((await previewHandler(post(admin))).enabled).toBe(false);
    await expect(startHandler(post(admin))).rejects.toMatchObject({ statusCode: 409, statusMessage: 'Album matching is turned off.' });
    expect(isAlbumMatchRunning()).toBe(false);
    expect(await settingsHandler(post(admin, { enabled: true }))).toEqual({ enabled: true });
    expect(await startHandler(post(admin))).toMatchObject({ started: true });
  });

  it('turning matching off stops a running run', async () => {
    const admin = login('ad', 'admin');
    await startHandler(post(admin));
    await expect.poll(() => searched.length).toBe(1);
    await settingsHandler(post(admin, { enabled: false }));
    release!();
    await waitIdle();
    expect(await statusHandler(mockEvent(admin))).toMatchObject({ state: 'cancelled' });
    expect(searched).toHaveLength(1);
  });
});
