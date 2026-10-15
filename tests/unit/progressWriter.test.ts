import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  createProgressWriter, createDbProgressWriter, startProgressWriter, finishProgressWriter, stopProgressWriter,
  type ProgressSnapshot,
} from '../../server/utils/progressWriter';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

const snap = (progress: number | null, speed = '1MiB/s', eta: string | null = '00:10'): ProgressSnapshot => ({ progress, speed, eta });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createProgressWriter', () => {
  it('writes the first update at once, then at most once per second with the latest value', () => {
    const writes: ProgressSnapshot[] = [];
    const w = createProgressWriter((s) => writes.push(s));
    w.update(snap(1));
    expect(writes.map((s) => s.progress)).toEqual([1]);

    w.update(snap(2));
    vi.advanceTimersByTime(300);
    w.update(snap(3));
    vi.advanceTimersByTime(600);
    expect(writes.map((s) => s.progress)).toEqual([1]);
    vi.advanceTimersByTime(100); // window ends 1000 ms after the first write
    expect(writes.map((s) => s.progress)).toEqual([1, 3]);

    // 50 lines within the next window give one write.
    for (let p = 4; p < 54; p++) { w.update(snap(p)); vi.advanceTimersByTime(10); }
    vi.advanceTimersByTime(1000);
    expect(writes.map((s) => s.progress)).toEqual([1, 3, 53]);
  });

  it('writes at once when the window has already passed', () => {
    const writes: ProgressSnapshot[] = [];
    const w = createProgressWriter((s) => writes.push(s));
    w.update(snap(1));
    vi.advanceTimersByTime(1500);
    w.update(snap(2));
    expect(writes.map((s) => s.progress)).toEqual([1, 2]);
  });

  it('only writes when percent, speed or eta changed', () => {
    const writes: ProgressSnapshot[] = [];
    const w = createProgressWriter((s) => writes.push(s));
    w.update(snap(5));
    vi.advanceTimersByTime(2000);
    w.update(snap(5));
    vi.advanceTimersByTime(2000);
    expect(writes).toHaveLength(1);

    w.update(snap(5, '2MiB/s'));
    vi.advanceTimersByTime(2000);
    w.update(snap(5, '2MiB/s', '00:05'));
    expect(writes).toHaveLength(3);

    // A pending value that returns to what is stored is dropped.
    w.update(snap(6, '2MiB/s', '00:05'));
    w.update(snap(5, '2MiB/s', '00:05'));
    vi.advanceTimersByTime(2000);
    expect(writes).toHaveLength(3);
  });

  it('flush and stop write the pending value; nothing is written after stop', () => {
    const writes: ProgressSnapshot[] = [];
    const w = createProgressWriter((s) => writes.push(s));
    w.update(snap(1));
    w.update(snap(2));
    w.flush();
    expect(writes.map((s) => s.progress)).toEqual([1, 2]);

    vi.advanceTimersByTime(100);
    w.update(snap(3));
    w.stop();
    expect(writes.map((s) => s.progress)).toEqual([1, 2, 3]);

    w.update(snap(4));
    w.flush();
    vi.advanceTimersByTime(5000);
    expect(writes.map((s) => s.progress)).toEqual([1, 2, 3]);
    w.update(snap(5)); // even long after the window
    expect(writes.map((s) => s.progress)).toEqual([1, 2, 3]);
  });

  it('a failing write never throws into the download', () => {
    const w = createProgressWriter(() => { throw new Error('SQLITE_BUSY'); });
    expect(() => { w.update(snap(1)); w.update(snap(2)); w.stop(); }).not.toThrow();
  });
});

describe('createDbProgressWriter', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'downloading' });
  });
  const row = () => db.prepare('SELECT download_status, download_progress, download_speed, download_eta FROM videos WHERE id = ?').get('v1') as any;

  it('writes progress, speed and eta; null progress or eta keeps the stored value', () => {
    const w = createDbProgressWriter(db, 'videos', 'v1');
    w.update(snap(40, '3MiB/s', '01:00'));
    expect(row()).toMatchObject({ download_progress: 40, download_speed: '3MiB/s', download_eta: '01:00' });
    vi.advanceTimersByTime(1000);
    w.update({ progress: null, speed: 'Comments page 2', eta: null });
    expect(row()).toMatchObject({ download_progress: 40, download_speed: 'Comments page 2', download_eta: '01:00' });
  });

  it('never writes to an item that left downloading', () => {
    const w = createDbProgressWriter(db, 'videos', 'v1');
    db.prepare("UPDATE videos SET download_status = 'pending', download_progress = 60, download_speed = NULL WHERE id = 'v1'").run();
    w.update(snap(70));
    expect(row()).toMatchObject({ download_status: 'pending', download_progress: 60, download_speed: null });
  });

  it('rejects an unknown table', () => {
    expect(() => createDbProgressWriter(db, 'users' as any, 'v1')).toThrow();
  });

  it('the registry lets a pause flush the live writer, and an old attempt never unregisters a newer one', () => {
    const first = startProgressWriter(db, 'videos', 'v1');
    first.update(snap(10));
    first.update(snap(20)); // throttled, pending
    stopProgressWriter('videos', 'v1');
    expect(row().download_progress).toBe(20);
    first.update(snap(30));
    vi.advanceTimersByTime(2000);
    expect(row().download_progress).toBe(20);

    const second = startProgressWriter(db, 'videos', 'v1');
    finishProgressWriter('videos', 'v1', first); // the old attempt's process exits late
    second.update(snap(50));
    second.update(snap(55));
    stopProgressWriter('videos', 'v1'); // still reaches the newer writer
    expect(row().download_progress).toBe(55);
  });
});
