import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// gracefulShutdown with every collaborator replaced by a recorder, so the
// order of the steps (and what happens when one of them throws) is visible.
const calls: string[] = [];
const failing = new Set<string>();
const record = (name: string, result?: unknown) => () => {
  calls.push(name);
  if (failing.has(name)) throw new Error(`${name} exploded`);
  return result;
};
let shuttingDown = false;

vi.mock('../../server/utils/db', () => ({ getDb: () => { throw new Error('the real database must not be used'); } }));
vi.mock('../../server/utils/downloader', () => ({
  activeProcesses: new Map([['v1', { name: 'video-child' }]]),
  activeCommentProcesses: new Map(),
  stopScheduler: record('stopScheduler'),
  stopVideoWorkerNow: record('stopVideoWorkerNow'),
}));
vi.mock('../../server/utils/musicDownloader', () => ({
  activeMusicProcesses: new Map(),
  stopMusicScheduler: record('stopMusicScheduler'),
  stopMusicWorkerNow: record('stopMusicWorkerNow'),
}));
vi.mock('../../server/utils/podcastDownloader', () => ({
  abortAllPodcastDownloads: record('abortAllPodcastDownloads', 2),
  stopPodcastScheduler: record('stopPodcastScheduler'),
  stopPodcastWorkerNow: record('stopPodcastWorkerNow'),
}));
vi.mock('../../server/utils/progressWriter', () => ({ stopAllProgressWriters: record('stopAllProgressWriters') }));
vi.mock('../../server/utils/thumbnails', () => ({ stopThumbCacheSweep: record('stopThumbCacheSweep') }));
vi.mock('../../server/utils/processTree', () => ({
  isShuttingDown: () => shuttingDown,
  markShuttingDown: (v = true) => { calls.push('markShuttingDown'); shuttingDown = v; },
  killProcessTree: (child: any) => { calls.push(`kill:${child.name}`); },
  killAllTrackedChildren: record('killAllTrackedChildren', 0),
}));

const { gracefulShutdown } = await import('../../server/utils/shutdown');
const { activeProcesses } = await import('../../server/utils/downloader') as any;

function fakeDb() {
  return {
    open: true,
    pragma: vi.fn((p: string) => { calls.push(`pragma:${p}`); }),
    close: vi.fn(function (this: any) { calls.push('db.close'); this.open = false; }),
  };
}

beforeEach(() => {
  calls.length = 0;
  failing.clear();
  shuttingDown = false;
  activeProcesses.clear();
  activeProcesses.set('v1', { name: 'video-child' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('gracefulShutdown', () => {
  it('stops workers first, then cron jobs, then kills downloads, flushes, checkpoints and closes', async () => {
    const db = fakeDb();
    await gracefulShutdown({ getDb: () => db as any, log: () => {} });
    const at = (name: string) => calls.indexOf(name);
    for (const name of ['stopVideoWorkerNow', 'stopMusicWorkerNow', 'stopPodcastWorkerNow']) {
      expect(at(name)).toBeGreaterThan(at('markShuttingDown'));
      expect(at(name)).toBeLessThan(at('kill:video-child'));
    }
    for (const name of ['stopScheduler', 'stopMusicScheduler', 'stopPodcastScheduler', 'stopThumbCacheSweep']) {
      expect(at(name)).toBeGreaterThan(-1);
      expect(at(name)).toBeLessThan(at('kill:video-child'));
    }
    expect(at('abortAllPodcastDownloads')).toBeGreaterThan(at('stopPodcastWorkerNow'));
    expect(at('stopAllProgressWriters')).toBeGreaterThan(at('abortAllPodcastDownloads'));
    expect(at('pragma:wal_checkpoint(TRUNCATE)')).toBeGreaterThan(at('stopAllProgressWriters'));
    expect(at('db.close')).toBeGreaterThan(at('pragma:wal_checkpoint(TRUNCATE)'));
    expect(calls.at(-1)).toBe('db.close');
  });

  it('logs how many processes and podcast downloads it stopped', async () => {
    const log = vi.fn();
    await gracefulShutdown({ getDb: () => fakeDb() as any, log });
    // One tracked video child + 2 aborted podcast downloads.
    expect(log).toHaveBeenCalledWith('Stopped 3 running process(es) and download(s).');
  });

  it('a second call does nothing at all', async () => {
    await gracefulShutdown({ getDb: () => fakeDb() as any, log: () => {} });
    calls.length = 0;
    const getDb = vi.fn(() => fakeDb() as any);
    const log = vi.fn();
    await gracefulShutdown({ getDb, log });
    expect(calls).toEqual([]);
    expect(getDb).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('one failing step does not stop the following ones', async () => {
    failing.add('stopVideoWorkerNow');
    failing.add('stopScheduler');
    failing.add('abortAllPodcastDownloads');
    failing.add('stopAllProgressWriters');
    const db = fakeDb();
    await gracefulShutdown({ getDb: () => db as any, log: () => {} });
    expect(calls).toContain('kill:video-child');
    expect(calls).toContain('pragma:wal_checkpoint(TRUNCATE)');
    expect(db.close).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(4);
  });

  it('a database that is already closed is left alone', async () => {
    const db = fakeDb();
    db.open = false;
    await gracefulShutdown({ getDb: () => db as any, log: () => {} });
    expect(db.pragma).not.toHaveBeenCalled();
    expect(db.close).not.toHaveBeenCalled();
  });

  it('folds the WAL back into the database even while another connection keeps it open', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-wal-'));
    try {
      const file = path.join(dir, 'x.db');
      const db = new Database(file);
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE t (v TEXT)');
      const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
      for (let i = 0; i < 200; i++) insert.run('x'.repeat(100));
      // A second connection (a backup tool, sqlite3 shell...) stops close() from checkpointing on its own.
      const other = new Database(file, { readonly: true });
      other.prepare('SELECT COUNT(*) FROM t').get();
      expect(fs.statSync(`${file}-wal`).size).toBeGreaterThan(0);
      await gracefulShutdown({ getDb: () => db, log: () => {} });
      expect(db.open).toBe(false);
      expect(fs.statSync(`${file}-wal`).size).toBe(0);
      other.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
