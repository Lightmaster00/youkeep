import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// yt-dlp is never run: spawn hands back fake processes and records the call.
const spawned: string[][] = [];
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: () => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }),
    spawn: (_cmd: string, args: string[]) => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => { setImmediate(() => { child.emit('exit', null, 'SIGKILL'); child.emit('close', null); }); };
      spawned.push(args);
      return child;
    },
  };
});

import {
  isDirWritable, getDownloadsDir, getDownloadsDirState, startQueueWorker, stopVideoWorkerNow, latestLogs,
} from '../../server/utils/downloader';
import { getDataDir } from '../../server/utils/dataDir';
import { requireAdmin } from '../../server/utils/auth';
import activeCounts from '../../server/api/admin/downloader/active-counts.get';
import { assertInTmp, createTestDb, insertChannel, insertVideo, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-blocked-'));
  assertInTmp(dir);
  spawned.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const setDownloadsSetting = (value: string) =>
  db.prepare("UPDATE settings SET value = ? WHERE key = 'default_downloads_dir'").run(value);

describe('isDirWritable', () => {
  it('creates only the last folder, and only when its parent exists', () => {
    const child = path.join(dir, 'videos');
    expect(isDirWritable(child)).toBe(true);
    expect(fs.statSync(child).isDirectory()).toBe(true);

    // A vanished mount: the share folder is gone, so nothing is recreated under it.
    const deep = path.join(dir, 'mnt', 'share', 'videos');
    expect(isDirWritable(deep)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'mnt'))).toBe(false);
  });

  it('a file is not a writable folder', () => {
    const file = path.join(dir, 'file');
    fs.writeFileSync(file, 'x');
    expect(isDirWritable(file)).toBe(false);
  });
});

describe('a configured downloads folder that is unavailable', () => {
  it('blocks downloads instead of falling back to a local folder', () => {
    const vanished = path.join(dir, 'mnt', 'share', 'videos');
    setDownloadsSetting(vanished);
    const state = getDownloadsDirState();
    expect(state.dir).toBe(vanished);
    expect(state.blockedReason).toMatch(/not writable|missing/);
    expect(getDownloadsDir()).toBe(vanished);
    expect(getDownloadsDir().startsWith(getDataDir())).toBe(false);
    expect(fs.existsSync(path.join(dir, 'mnt'))).toBe(false);
  });

  it('is not blocked when nothing is configured (built-in default or local fallback)', () => {
    setDownloadsSetting('');
    expect(getDownloadsDirState().blockedReason).toBeNull();
  });

  it('is reported by the active counts', async () => {
    insertUser(db, { id: 'admin', role: 'admin' });
    insertSession(db, { id: 'sess-admin', userId: 'admin' });
    setDownloadsSetting(path.join(dir, 'gone', 'videos'));
    const res: any = await activeCounts(mockEvent(sessionCookie('sess-admin')));
    expect(res.blockedReason).toMatch(/gone/);
    setDownloadsSetting(dir);
    const ok: any = await activeCounts(mockEvent(sessionCookie('sess-admin')));
    expect(ok.blockedReason).toBeNull();
  });

  it('the video worker starts no download while blocked, logs it loudly, and resumes once writable', async () => {
    const bin = path.join(getDataDir(), 'bin');
    assertInTmp(bin);
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'yt-dlp'), 'fake');
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'downloader_paused'").run();
    insertChannel(db, { id: 'c1' });
    db.prepare("UPDATE channels SET sync_status = 'downloading' WHERE id = 'c1'").run();
    insertVideo(db, { id: 'vid00000001', channelId: 'c1', downloadStatus: 'pending' });
    const target = path.join(dir, 'nas', 'videos');
    setDownloadsSetting(target);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const worker = startQueueWorker();
    const step = async () => { await vi.advanceTimersByTimeAsync(20_000); await new Promise((r) => setImmediate(r)); };
    try {
      for (let i = 0; i < 5; i++) await step();
      expect(spawned).toHaveLength(0);
      expect((db.prepare("SELECT download_status FROM videos WHERE id = 'vid00000001'").get() as any).download_status).toBe('pending');
      expect(latestLogs.some((l) => /blocked/i.test(l))).toBe(true);
      expect((console.error as any).mock.calls.some((c: any[]) => /blocked/i.test(String(c[0])))).toBe(true);

      // The mount comes back.
      fs.mkdirSync(path.join(dir, 'nas'));
      for (let i = 0; i < 20 && spawned.length === 0; i++) await step();
      expect(spawned.length).toBeGreaterThan(0);
    } finally {
      stopVideoWorkerNow();
      for (let i = 0; i < 20; i++) await step();
      vi.useRealTimers();
      await Promise.race([worker, new Promise((r) => setTimeout(r, 200))]);
    }
  });
});
