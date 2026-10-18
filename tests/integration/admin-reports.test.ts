import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import * as auth from '../../server/utils/auth';
import { createApiToken } from '../../server/utils/apiTokens';
import { assertInTmp, mockEvent, sessionCookie } from '../helpers/testDb';
import listReports from '../../server/api/admin/reports/index.get';
import deleteReport from '../../server/api/admin/reports/[id].delete';

// The admin view of video reports (#21): latest first, with the video and
// channel titles; admin browser session only.
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;
let adminToken: string;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-reports-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
  Object.assign(globalThis as any, auth);
  const now = Date.now();
  for (const [id, role] of [['admin', 'admin'], ['bob', 'user']]) {
    db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, id, 'x', role, now);
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(`sess-${id}`, id, now + 3_600_000);
  }
  adminToken = createApiToken('admin', 'script').token;
  db.prepare("INSERT INTO channels (id, title, created_at) VALUES ('ch1', 'Cooking', ?)").run(now);
  db.prepare("INSERT INTO videos (id, title, channel_id, download_status, created_at) VALUES ('v1', 'Sushi', 'ch1', 'completed', ?)").run(now);
  db.prepare("INSERT INTO videos (id, title, channel_id, download_status, created_at) VALUES ('v2', 'Bread', 'ch1', 'completed', ?)").run(now);
  db.prepare("INSERT INTO reports (id, video_id, user_id, reason, created_at) VALUES ('r1', 'v1', 'bob', 'Wrong audio', 1000)").run();
  db.prepare("INSERT INTO reports (id, video_id, user_id, reason, created_at) VALUES ('r2', 'v2', 'bob', 'Broken file', 2000)").run();
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const status = async (p: Promise<any>) => { try { await p; return 200; } catch (e: any) { return e?.statusCode ?? 500; } };
const ADMIN = { cookie: sessionCookie('sess-admin') };
const MEMBER = { cookie: sessionCookie('sess-bob') };
const TOKEN = () => ({ authorization: `Bearer ${adminToken}` });
const get = (headers: Record<string, string>) => listReports(mockEvent(headers.cookie, { headers }));
const del = (headers: Record<string, string>, id: string) => deleteReport(mockEvent(headers.cookie, { method: 'DELETE', headers, params: { id } }));

describe('GET /api/admin/reports', () => {
  it('lists the latest reports with the video and channel titles', async () => {
    const res: any = await get(ADMIN);
    expect(res.reports.map((r: any) => r.id)).toEqual(['r2', 'r1']);
    expect(res.reports[0]).toMatchObject({ videoId: 'v2', videoTitle: 'Bread', channelTitle: 'Cooking', reason: 'Broken file', reporter: 'bob' });
  });

  it('guest 401, member 403, admin API token 403', async () => {
    expect(await status(get({}))).toBe(401);
    expect(await status(get(MEMBER))).toBe(403);
    expect(await status(get(TOKEN()))).toBe(403);
  });

  it('caps the list at 100', async () => {
    const ins = db.prepare("INSERT INTO reports (id, video_id, user_id, reason, created_at) VALUES (?, 'v1', NULL, 'x', ?)");
    for (let i = 0; i < 120; i++) ins.run(`bulk${i}`, 5000 + i);
    const res: any = await get(ADMIN);
    expect(res.reports).toHaveLength(100);
  });
});

describe('DELETE /api/admin/reports/:id', () => {
  it('dismisses a report; unknown ids are 404', async () => {
    await expect(del(ADMIN, 'r1')).resolves.toEqual({ success: true });
    expect((db.prepare('SELECT COUNT(*) AS n FROM reports').get() as any).n).toBe(1);
    expect(await status(del(ADMIN, 'r1'))).toBe(404);
  });

  it('guest 401, member 403, admin API token 403 (nothing deleted)', async () => {
    expect(await status(del({}, 'r1'))).toBe(401);
    expect(await status(del(MEMBER, 'r1'))).toBe(403);
    expect(await status(del(TOKEN(), 'r1'))).toBe(403);
    expect((db.prepare('SELECT COUNT(*) AS n FROM reports').get() as any).n).toBe(2);
  });
});
