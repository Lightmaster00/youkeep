import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// yt-dlp is never run: spawn hands back controllable fake processes.
const spawned: { args: string[]; child: any }[] = [];
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: () => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }),
    spawn: (_cmd: string, args: string[]) => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.kill = vi.fn(() => { child.signalCode = 'SIGKILL'; setImmediate(() => { child.emit('exit', null, 'SIGKILL'); child.emit('close', null); }); });
      spawned.push({ args, child });
      return child;
    },
  };
});

import {
  activeProcesses, activeCommentProcesses, cancelDownload, extractCommentsParallel, ingestUrl, videoImportDeps,
  startQueueWorker, stopVideoWorkerNow, COMMENTS_MAX_STDOUT_BYTES, COMMENTS_TIMEOUT_MS, downloadVideoFile,
} from '../../server/utils/downloader';
import { gracefulShutdown } from '../../server/utils/shutdown';
import { markShuttingDown } from '../../server/utils/processTree';
import { startProgressWriter } from '../../server/utils/progressWriter';
import { getDataDir } from '../../server/utils/dataDir';
import { assertInTmp, createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

let db: Database.Database;
let dir: string;
const tick = () => new Promise((r) => setImmediate(r));
const commentChildren = () => spawned.filter((s) => s.args.includes('--get-comments'));

beforeAll(() => {
  const bin = path.join(getDataDir(), 'bin');
  assertInTmp(bin);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'yt-dlp'), 'fake');
});
beforeEach(() => {
  db = createTestDb();
  for (const col of ['description TEXT', 'banner_url TEXT', 'download_videos INTEGER DEFAULT 1', 'download_shorts INTEGER DEFAULT 0',
    'download_lives INTEGER DEFAULT 0', 'date_after TEXT']) db.exec(`ALTER TABLE channels ADD COLUMN ${col}`);
  (globalThis as any).getDb = () => db;
  (globalThis as any).isWipeInProgress = () => false;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-proc-'));
  spawned.length = 0;
  vi.spyOn(console, 'log').mockImplementation((m) => { if (process.env.DBG) process.stderr.write(String(m)+'\n'); });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  activeProcesses.clear();
  activeCommentProcesses.clear();
  markShuttingDown(false);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('parallel comment extraction', () => {
  it('is tracked with the download, capped, and killed by a cancel', async () => {
    insertChannel(db, { id: 'c1', customSavePath: dir });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'downloading' });
    const done = downloadVideoFile('v1', 'c1').catch((e) => e);
    await vi.waitFor(() => expect(commentChildren()).toHaveLength(1));
    const comments = commentChildren()[0]!;
    expect(comments.args).toContain('--extractor-args');
    expect(comments.args.find((a) => a.startsWith('youtube:max_comments='))).toBeDefined();
    expect(activeCommentProcesses.get('v1')).toBe(comments.child);

    cancelDownload('v1', 'failed');
    expect(comments.child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(activeCommentProcesses.has('v1')).toBe(false);
    await done;
  });

  it('a pause kills it too', async () => {
    insertChannel(db, { id: 'c1', customSavePath: dir });
    insertVideo(db, { id: 'v2', channelId: 'c1', downloadStatus: 'downloading' });
    const done = downloadVideoFile('v2', 'c1').catch((e) => e);
    await vi.waitFor(() => expect(commentChildren()).toHaveLength(1));
    cancelDownload('v2', 'pending', true);
    expect(commentChildren()[0]!.child.kill).toHaveBeenCalled();
    await done;
  });

  it('is killed past its time limit or its output cap, and survives a spawn error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const slow = extractCommentsParallel('t1', 'https://www.youtube.com/watch?v=t1', '/fake/yt-dlp', {});
    vi.advanceTimersByTime(COMMENTS_TIMEOUT_MS);
    await slow;
    expect(commentChildren()[0]!.child.kill).toHaveBeenCalled();
    expect(activeCommentProcesses.has('t1')).toBe(false);
    vi.useRealTimers();

    const big = extractCommentsParallel('t2', 'u', '/fake/yt-dlp', {});
    const child = commentChildren()[1]!.child;
    child.stdout.emit('data', Buffer.alloc(COMMENTS_MAX_STDOUT_BYTES + 1));
    await big;
    expect(child.kill).toHaveBeenCalled();

    const broken = extractCommentsParallel('t3', 'u', '/fake/yt-dlp', {});
    commentChildren()[2]!.child.emit('error', new Error('ENOENT'));
    await expect(broken).resolves.toBeUndefined();
  });
});

describe('re-adding a video that is downloading', () => {
  it('does not reset it to pending, and the worker never starts a second process for an active id', async () => {
    insertChannel(db, { id: 'UCc', title: 'Chan' });
    insertVideo(db, { id: 'busy1', channelId: 'UCc', downloadStatus: 'downloading' });
    const original = { ...videoImportDeps };
    videoImportDeps.runYtdl = vi.fn(async () => ({ stdout: JSON.stringify({ id: 'busy1', title: 'B', channel_id: 'UCc' }), stderr: '', status: 0 })) as any;
    videoImportDeps.startWorker = vi.fn() as any;
    try {
      await ingestUrl('https://www.youtube.com/watch?v=busy1');
    } finally {
      Object.assign(videoImportDeps, original);
    }
    expect((db.prepare("SELECT download_status FROM videos WHERE id = 'busy1'").get() as any).download_status).toBe('downloading');

    // Even a row that says 'pending' is never picked while its process runs.
    db.prepare("UPDATE videos SET download_status = 'pending', is_manually_queued = 1 WHERE id = 'busy1'").run();
    activeProcesses.set('busy1', { kill() {} });
    startQueueWorker();
    await new Promise((r) => setTimeout(r, 100));
    stopVideoWorkerNow();
    expect(spawned).toHaveLength(0);
    expect((console.log as any).mock.calls.some((c: any[]) => String(c[0]).includes('System error'))).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe('queue worker system errors', () => {
  it('keeps going after more than 5 database errors in a row', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let failures = 7;
    const real = db;
    (globalThis as any).getDb = () => new Proxy(real, {
      get(target, prop) {
        if (prop === 'prepare' && failures > 0) return () => { failures--; throw new Error('SQLITE_BUSY'); };
        const value = (target as any)[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    let finished = false;
    const worker = startQueueWorker().then(() => { finished = true; });
    // Real I/O (the free-space check) happens between fake timer steps: step until done.
    const step = async () => { await vi.advanceTimersByTimeAsync(60_000); await new Promise((r) => setImmediate(r)); };
    for (let i = 0; i < 200 && failures > 0; i++) await step();
    expect(failures).toBe(0);
    for (let i = 0; i < 5; i++) await step();
    expect(finished).toBe(false); // still polling after 7 errors in a row
    stopVideoWorkerNow();
    for (let i = 0; i < 200 && !finished; i++) await step();
    await worker;
    const logs = (console.log as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(logs.some((l: string) => l.includes('7 in a row'))).toBe(true);
  });
});

describe('graceful shutdown', () => {
  it('kills downloads, keeps their rows for resume, flushes progress and closes the database, once', async () => {
    const file = path.join(dir, 'db.sqlite');
    const fileDb = new Database(file);
    fileDb.pragma('journal_mode = WAL');
    fileDb.exec("CREATE TABLE videos (id TEXT PRIMARY KEY, download_status TEXT, download_progress INTEGER, download_speed TEXT, download_eta TEXT)");
    fileDb.prepare("INSERT INTO videos VALUES ('s1', 'downloading', 0, NULL, NULL)").run();
    const child = { kill: vi.fn(), pid: undefined };
    activeProcesses.set('s1', child);
    const comment = { kill: vi.fn(), pid: undefined };
    activeCommentProcesses.set('s1', comment);
    const writer = startProgressWriter(fileDb, 'videos', 's1');
    writer.update({ progress: 10, speed: 'a', eta: 'b' });
    writer.update({ progress: 42, speed: 'a', eta: 'b' }); // throttled, pending

    await gracefulShutdown({ getDb: () => fileDb, log: () => {} });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(comment.kill).toHaveBeenCalledWith('SIGKILL');
    expect(activeProcesses.size).toBe(0);
    expect(fileDb.open).toBe(false);
    await gracefulShutdown({ getDb: () => { throw new Error('called twice'); }, log: () => {} });

    const reopened = new Database(file);
    expect(reopened.prepare("SELECT download_status, download_progress FROM videos WHERE id = 's1'").get()).toEqual({ download_status: 'downloading', download_progress: 42 });
    reopened.close();
    expect(fs.existsSync(`${file}-wal`) ? fs.statSync(`${file}-wal`).size : 0).toBe(0);
  });
});
