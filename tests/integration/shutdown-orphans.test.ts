import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// No real process is ever started: spawn hands back long-running fakes whose
// kill() is observable.
const spawned: any[] = [];
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: () => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = undefined; // never a process group: kill() is the fallback used
      child.exitCode = null;
      child.signalCode = null;
      child.kill = vi.fn(() => { child.signalCode = 'SIGKILL'; setImmediate(() => { child.emit('exit', null, 'SIGKILL'); child.emit('close', null); }); return true; });
      spawned.push(child);
      return child;
    },
  };
});

import { gracefulShutdown } from '../../server/utils/shutdown';
import { markShuttingDown, spawnInGroup, trackChild, trackedChildCount, killAllTrackedChildren } from '../../server/utils/processTree';
import { runSyncAllEntities } from '../../server/utils/concurrency';
import { enqueueBackgroundImport, backgroundImportsIdle } from '../../server/utils/backgroundImports';
import { createTestDb } from '../helpers/testDb';

afterEach(() => {
  markShuttingDown(false);
  killAllTrackedChildren();
  spawned.length = 0;
  vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setImmediate(r));

describe('no new child process once shutdown started', () => {
  it('spawnInGroup refuses: the child reports an error and no process is started', async () => {
    markShuttingDown(true);
    const child = spawnInGroup('yt-dlp', ['--version']);
    expect(spawned).toHaveLength(0);
    const errP = new Promise<any>((resolve) => child.once('error', resolve));
    const closeP = new Promise<any>((resolve) => child.once('close', (code) => resolve(code)));
    expect((await errP).code).toBe('ESHUTDOWN');
    expect(await closeP).not.toBe(0);
  });

  it('trackChild kills a child handed to it during shutdown', () => {
    const child = spawnInGroup('yt-dlp', ['--version']);
    markShuttingDown(true);
    trackChild(child);
    expect((child as any).kill).toHaveBeenCalled();
  });

  it('a child that slipped in during the shutdown window is killed before the database closes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-orphan-'));
    const fileDb = new Database(path.join(dir, 'x.db'));
    let lateChild: any = null;
    let killedBeforeClose = false;
    const realClose = fileDb.close.bind(fileDb);
    (fileDb as any).close = () => { killedBeforeClose = !!lateChild && lateChild.kill.mock.calls.length > 0; return realClose(); };
    const done = gracefulShutdown({ getDb: () => fileDb, log: () => {} });
    // A loop started a long-running yt-dlp in the 50 ms window (simulating a
    // race past the shutdown flag).
    markShuttingDown(false);
    lateChild = trackChild(spawnInGroup('yt-dlp', ['--dump-single-json', 'x']));
    markShuttingDown(true);
    expect(lateChild.kill).not.toHaveBeenCalled();
    await done;
    expect(killedBeforeClose).toBe(true);
    expect(trackedChildCount()).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('loops stop once shutdown started', () => {
  it('runSyncAllEntities processes no further entity', async () => {
    const db = createTestDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('sync_all_active', '0'), ('downloader_paused', '0')").run();
    const seen: number[] = [];
    const startWorker = vi.fn();
    await runSyncAllEntities({
      db,
      activeFlagSettingKey: 'sync_all_active',
      pausedSettingKey: 'downloader_paused',
      fetchEntities: () => [1, 2, 3],
      processEntity: async (n) => { seen.push(n); if (n === 1) markShuttingDown(true); },
      onStart: () => {},
      onPaused: () => {},
      onComplete: () => {},
      onFatalError: () => {},
      afterLoop: async () => { seen.push(99); },
      startWorker,
    });
    expect(seen).toEqual([1]);
    expect(startWorker).not.toHaveBeenCalled();
  });

  it('background imports queued during shutdown do not start', async () => {
    markShuttingDown(true);
    const task = vi.fn(async () => {});
    enqueueBackgroundImport('video:UCshutdown', task);
    await tick();
    await tick();
    await backgroundImportsIdle();
    expect(task).not.toHaveBeenCalled();
  });
});
