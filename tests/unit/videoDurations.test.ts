import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';
import { backfillMissingVideoDurations } from '../../server/utils/videoDurations';

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
});
