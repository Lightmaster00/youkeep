import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import * as auth from '../../server/utils/auth';
import { createApiToken } from '../../server/utils/apiTokens';
import { startLibraryWipe, isWipeInProgress } from '../../server/utils/libraryWipe';
import { getDownloadsDir } from '../../server/utils/downloader';
import { getMusicDownloadsDir } from '../../server/utils/musicDownloader';
import { getPodcastDownloadsDir } from '../../server/utils/podcastDownloader';
import { assertInTmp, mockEvent, sessionCookie } from '../helpers/testDb';
import wipeAll from '../../server/api/admin/system/wipe-all.post';
import tidyStart from '../../server/api/admin/library/tidy/start.post';
import defaultDirPost from '../../server/api/admin/downloader/default-dir.post';

// Destructive library routes need a real admin browser session: a leaked
// API token must not be able to wipe the library or move the downloads.
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;
let adminToken: string;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-destructive-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
  Object.assign(globalThis as any, auth, { startLibraryWipe, getDownloadsDir });
  const now = Date.now();
  for (const [id, role] of [['admin', 'admin'], ['bob', 'user']]) {
    db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, id, 'x', role, now);
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(`sess-${id}`, id, now + 3_600_000);
  }
  adminToken = createApiToken('admin', 'script').token;
});
afterEach(async () => {
  for (let i = 0; i < 200 && isWipeInProgress(); i++) await new Promise((r) => setTimeout(r, 5));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const status = async (p: Promise<any>) => { try { await p; return 200; } catch (e: any) { return e?.statusCode ?? 500; } };
const ev = (headers: Record<string, string>, body?: unknown) =>
  mockEvent(headers.cookie, { method: 'POST', headers, ...(body !== undefined ? { body } : {}) });
const GUEST = {};
const MEMBER = { cookie: sessionCookie('sess-bob') };
const TOKEN = () => ({ authorization: `Bearer ${adminToken}` });

describe.each([
  ['POST /api/admin/system/wipe-all', wipeAll, undefined],
  ['POST /api/admin/library/tidy/start', tidyStart, undefined],
  ['POST /api/admin/downloader/default-dir', defaultDirPost, { path: '' }],
])('%s', (_name, handler: any, body) => {
  it('guest 401, member 403, admin API token 403 (nothing started)', async () => {
    expect(await status(handler(ev(GUEST, body)))).toBe(401);
    expect(await status(handler(ev(MEMBER, body)))).toBe(403);
    await expect(handler(ev(TOKEN(), body))).rejects.toMatchObject({ statusCode: 403, statusMessage: 'Not available with an API token.' });
    expect(isWipeInProgress()).toBe(false);
  });
});

describe('wipe-all with an admin session', () => {
  it('removes every channel, artist and show with their folders', async () => {
    const now = Date.now();
    db.prepare("INSERT INTO channels (id, title, created_at) VALUES ('UCwipe', 'Wipe Chan', ?)").run(now);
    db.prepare("INSERT INTO videos (id, title, channel_id, download_status, local_video_path, created_at) VALUES ('wipevid0001', 'V', 'UCwipe', 'completed', '/downloads/Wipe%20Chan/wipevid0001.mp4', ?)").run(now);
    db.prepare("INSERT INTO music_artists (id, name, created_at) VALUES ('artwipe', 'Wipe Artist', ?)").run(now);
    db.prepare("INSERT INTO music_tracks (id, artist_id, title, download_status, local_file_path, created_at) VALUES ('trkwipe0001', 'artwipe', 'T', 'completed', '/downloads-music/Wipe%20Artist/trkwipe0001.opus', ?)").run(now);
    db.prepare("INSERT INTO podcast_shows (id, feed_url, title, created_at) VALUES ('showwipe', 'https://example.invalid/f', 'Wipe Show', ?)").run(now);
    db.prepare("INSERT INTO podcast_episodes (id, show_id, title, audio_url, download_status, local_file_path, created_at) VALUES ('epwipe', 'showwipe', 'E', 'https://example.invalid/a.mp3', 'completed', '/downloads-podcasts/Wipe%20Show/epwipe.mp3', ?)").run(now);
    const files = [
      path.join(getDownloadsDir(), 'Wipe Chan', 'wipevid0001.mp4'),
      path.join(getMusicDownloadsDir(), 'Wipe Artist', 'trkwipe0001.opus'),
      path.join(getPodcastDownloadsDir(), 'Wipe Show', 'epwipe.mp3'),
    ];
    for (const f of files) {
      assertInTmp(f);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, 'x');
    }

    expect(await wipeAll(ev({ cookie: sessionCookie('sess-admin') }))).toEqual({ started: true });
    for (let i = 0; i < 400 && isWipeInProgress(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(isWipeInProgress()).toBe(false);

    for (const table of ['channels', 'videos', 'music_artists', 'podcast_shows']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n).toBe(0);
    }
    expect(files.filter((f) => fs.existsSync(f))).toEqual([]);
  });
});
