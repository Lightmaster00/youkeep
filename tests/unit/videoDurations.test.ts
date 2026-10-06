import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';
import { EventEmitter } from 'events';
import { backfillMissingVideoDurations, runFfprobe } from '../../server/utils/videoDurations';

const wipe = vi.hoisted(() => ({ on: false }));
vi.mock('../../server/utils/libraryWipe', () => ({ isWipeInProgress: () => wipe.on }));

let dir: string;
let db: ReturnType<typeof createTestDb>;
const dur = (id: string) => (db.prepare('SELECT duration FROM videos WHERE id = ?').get(id) as any).duration;

function addVideo(id: string, o: { duration?: number | null; status?: string; file?: boolean; path?: string | null } = {}) {
  const lp = o.path === undefined ? `/downloads/Channel c1/${id}.mp4` : o.path;
  insertVideo(db, { id, channelId: 'c1', duration: o.duration ?? null, downloadStatus: o.status ?? 'completed', localVideoPath: lp });
  if (o.file !== false) {
    fs.mkdirSync(path.join(dir, 'Channel c1'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Channel c1', `${id}.mp4`), 'x');
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dur-'));
  db = createTestDb();
  insertChannel(db, { id: 'c1' });
  wipe.on = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('backfillMissingVideoDurations', () => {
  it('fills NULL durations (rounded) and reports counts', async () => {
    addVideo('a');
    const probe = vi.fn(async () => 90.4);
    const r = await backfillMissingVideoDurations(db, probe, { downloadsDir: dir });
    expect(r).toEqual({ checked: 1, updated: 1 });
    expect(dur('a')).toBe(90);
    expect(probe).toHaveBeenCalledWith(path.join(dir, 'Channel c1', 'a.mp4'));
  });
  it('skips non-null, non-completed, no-path and missing-file videos', async () => {
    addVideo('has', { duration: 30 });
    addVideo('pend', { status: 'pending' });
    addVideo('nopath', { path: null, file: false });
    addVideo('gone', { file: false });
    const probe = vi.fn(async () => 50);
    const r = await backfillMissingVideoDurations(db, probe, { downloadsDir: dir });
    expect(probe).not.toHaveBeenCalled();
    expect(r.updated).toBe(0);
    expect(dur('has')).toBe(30);
    expect(dur('pend')).toBeNull();
  });
  it('respects the limit', async () => {
    for (const id of ['a', 'b', 'c']) addVideo(id);
    const r = await backfillMissingVideoDurations(db, async () => 10, { downloadsDir: dir, limit: 2 });
    expect(r).toEqual({ checked: 2, updated: 2 });
    expect(db.prepare('SELECT COUNT(*) n FROM videos WHERE duration IS NULL').get()).toEqual({ n: 1 });
  });
  it('survives throwing / null / NaN / 0 probes and continues', async () => {
    for (const id of ['t', 'n', 'nan', 'z', 'ok']) addVideo(id);
    const probe = async (f: string) => {
      const id = path.basename(f, '.mp4');
      if (id === 't') throw new Error('boom');
      if (id === 'n') return null;
      if (id === 'nan') return NaN;
      if (id === 'z') return 0;
      return 42;
    };
    const r = await backfillMissingVideoDurations(db, probe, { downloadsDir: dir });
    expect(r).toEqual({ checked: 5, updated: 1 });
    expect(dur('ok')).toBe(42);
    expect(dur('t')).toBeNull();
    expect(dur('z')).toBeNull();
  });
  it('uses the channel custom_save_path when set', async () => {
    const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'dur-c-'));
    db.prepare('UPDATE channels SET custom_save_path = ? WHERE id = ?').run(custom, 'c1');
    addVideo('a', { file: false });
    fs.mkdirSync(path.join(custom, 'Channel c1'));
    fs.writeFileSync(path.join(custom, 'Channel c1', 'a.mp4'), 'x');
    const r = await backfillMissingVideoDurations(db, async () => 7, { downloadsDir: dir });
    expect(r.updated).toBe(1);
    fs.rmSync(custom, { recursive: true, force: true });
  });

  it('missing-file rows beyond the limit do not starve later valid rows', async () => {
    for (let i = 0; i < 5; i++) addVideo(`a${i}`, { file: false });
    addVideo('z1'); addVideo('z2');
    const r = await backfillMissingVideoDurations(db, async () => 10, { downloadsDir: dir, limit: 2 });
    expect(r).toEqual({ checked: 2, updated: 2 });
    expect(dur('z1')).toBe(10);
    expect(dur('z2')).toBe(10);
  });
  it('probes in stable id order across batches', async () => {
    for (let i = 0; i < 250; i++) addVideo(`v${String(i).padStart(3, '0')}`);
    const seen: string[] = [];
    await backfillMissingVideoDurations(db, async (f) => { seen.push(path.basename(f, '.mp4')); return 5; }, { downloadsDir: dir, limit: 230 });
    expect(seen.length).toBe(230);
    expect(seen).toEqual([...seen].sort());
    expect(new Set(seen).size).toBe(230);
  });
  it('hard-caps rows examined', async () => {
    for (let i = 0; i < 10; i++) addVideo(`m${i}`, { file: false });
    addVideo('zz');
    const r = await backfillMissingVideoDurations(db, async () => 10, { downloadsDir: dir, maxExamined: 5 });
    expect(r).toEqual({ checked: 0, updated: 0 });
    expect(dur('zz')).toBeNull();
  });
  it('falls back to the channel id when the title is empty', async () => {
    db.prepare("UPDATE channels SET title = '' WHERE id = 'c1'").run();
    addVideo('a', { file: false });
    fs.mkdirSync(path.join(dir, 'c1'));
    fs.writeFileSync(path.join(dir, 'c1', 'a.mp4'), 'x');
    const r = await backfillMissingVideoDurations(db, async () => 9, { downloadsDir: dir });
    expect(r.updated).toBe(1);
  });
  it('refuses paths escaping the channel dir', async () => {
    db.prepare("UPDATE channels SET title = '..' WHERE id = 'c1'").run();
    addVideo('esc-a', { file: false });
    const outside = path.join(path.dirname(dir), 'esc-a.mp4');
    fs.writeFileSync(outside, 'x');
    const probe = vi.fn(async () => 9);
    const r = await backfillMissingVideoDurations(db, probe, { downloadsDir: dir });
    fs.rmSync(outside, { force: true });
    expect(probe).not.toHaveBeenCalled();
    expect(r.checked).toBe(0);
  });
  it('does nothing during a library wipe', async () => {
    addVideo('a'); wipe.on = true;
    const probe = vi.fn(async () => 9);
    expect(await backfillMissingVideoDurations(db, probe, { downloadsDir: dir })).toEqual({ checked: 0, updated: 0 });
    expect(probe).not.toHaveBeenCalled();
  });
  it('does nothing when the video module is disabled', async () => {
    addVideo('a');
    db.prepare("INSERT INTO settings (key, value) VALUES ('video_module_enabled', '0')").run();
    const probe = vi.fn(async () => 9);
    expect(await backfillMissingVideoDurations(db, probe, { downloadsDir: dir })).toEqual({ checked: 0, updated: 0 });
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('runFfprobe', () => {
  function fakeSpawn() {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = vi.fn();
    return { child, spawnFn: (() => child) as any };
  }
  afterEach(() => vi.useRealTimers());

  it('kills the child and resolves null on timeout, clearing the timer', async () => {
    vi.useFakeTimers();
    const { child, spawnFn } = fakeSpawn();
    const p = runFfprobe('/x.mp4', { spawnFn, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBeNull();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', 0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('parses stdout on success and clears the timer', async () => {
    vi.useFakeTimers();
    const { child, spawnFn } = fakeSpawn();
    const p = runFfprobe('/x.mp4', { spawnFn, timeoutMs: 1000 });
    child.stdout.emit('data', Buffer.from('12.5\n'));
    child.emit('close', 0);
    expect(await p).toBe(12.5);
    expect(vi.getTimerCount()).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();
  });
  it('resolves null on non-zero exit or spawn error', async () => {
    let f = fakeSpawn();
    let p = runFfprobe('/x.mp4', { spawnFn: f.spawnFn });
    f.child.stdout.emit('data', '5'); f.child.emit('close', 1);
    expect(await p).toBeNull();
    f = fakeSpawn();
    p = runFfprobe('/x.mp4', { spawnFn: f.spawnFn });
    f.child.emit('error', new Error('ENOENT'));
    expect(await p).toBeNull();
  });
});
