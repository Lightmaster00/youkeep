import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// yt-dlp and ffmpeg are never run: spawn hands back controllable fake processes.
const children: { args: string[]; child: any }[] = [];
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: () => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }),
    spawn: (_cmd: string, args: string[]) => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      children.push({ args, child });
      // The parallel comment extraction of a video ends at once.
      if (args.includes('--get-comments')) setImmediate(() => child.emit('close', 1));
      return child;
    },
  };
});

import { downloadVideoFile, cancelDownload } from '../../server/utils/downloader';
import { downloadMusicTrackFile, cancelMusicDownload } from '../../server/utils/musicDownloader';
import { downloadEpisodeFile, cancelPodcastDownload } from '../../server/utils/podcastDownloader';
import { getDataDir } from '../../server/utils/dataDir';
import { assertInTmp, createTestDb, insertChannel, insertVideo, insertMusicArtist, insertMusicTrack, insertPodcastShow, insertPodcastEpisode } from '../helpers/testDb';
import { safeUrlDeps } from '../../server/utils/safeUrl';

let db: Database.Database;
let dir: string;

beforeAll(() => {
  // getYtdlPath() finds a (fake) managed binary instead of downloading one.
  const bin = path.join(getDataDir(), 'bin');
  assertInTmp(bin);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'), 'fake');
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-progress-'));
  db.prepare("INSERT INTO settings (key, value) VALUES ('default_downloads_dir', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(dir);
  children.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

const tick = () => new Promise((r) => setImmediate(r));
async function until(cond: () => unknown) {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
  if (!cond()) throw new Error('condition never met');
}
const line = (pct: number) => `[download]  ${pct.toFixed(1)}% of 10.00MiB at  1.00MiB/s ETA 00:09\n`;

describe('yt-dlp progress is throttled to one write per second', () => {
  const cases = [
    {
      name: 'video',
      table: 'videos',
      seed: () => { insertChannel(db, { id: 'c1', customSavePath: dir }); insertVideo(db, { id: 'x1', channelId: 'c1', downloadStatus: 'downloading' }); },
      start: () => downloadVideoFile('x1', 'c1'),
      pause: () => cancelDownload('x1', 'pending', true),
    },
    {
      name: 'music track',
      table: 'music_tracks',
      seed: () => { insertMusicArtist(db, { id: 'a1', name: 'Artist' }); insertMusicTrack(db, { id: 'x1', artistId: 'a1', downloadStatus: 'downloading' }); },
      start: () => downloadMusicTrackFile('x1', 'a1'),
      pause: () => cancelMusicDownload('x1', 'pending', true),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: first line at once, then the latest each second, unchanged values skipped, pause flushes, nothing after`, async () => {
      c.seed();
      const row = () => db.prepare(`SELECT download_status, download_progress FROM ${c.table} WHERE id = 'x1'`).get() as { download_status: string; download_progress: number };
      const done = c.start().catch((err) => err);
      await until(() => children.find((ch) => !ch.args.includes('--get-comments')));
      const proc = children.find((ch) => !ch.args.includes('--get-comments'))!.child;

      proc.stdout.emit('data', Buffer.from(line(10)));
      expect(row().download_progress).toBe(10);
      proc.stdout.emit('data', Buffer.from(line(20)));
      proc.stdout.emit('data', Buffer.from(line(30)));
      expect(row().download_progress).toBe(10);
      vi.advanceTimersByTime(1000);
      expect(row().download_progress).toBe(30);

      // The same values again are not written (the marker 99 survives).
      db.prepare(`UPDATE ${c.table} SET download_progress = 99 WHERE id = 'x1'`).run();
      vi.advanceTimersByTime(2000);
      proc.stdout.emit('data', Buffer.from(line(30)));
      expect(row().download_progress).toBe(99);

      // A pause writes the throttled value before the status changes.
      proc.stdout.emit('data', Buffer.from(line(40)));
      proc.stdout.emit('data', Buffer.from(line(45)));
      expect(row().download_progress).toBe(40);
      c.pause();
      expect(row()).toEqual({ download_status: 'pending', download_progress: 45 });

      // Output still arriving from the dying process is never written.
      proc.stdout.emit('data', Buffer.from(line(50)));
      vi.advanceTimersByTime(5000);
      expect(row()).toEqual({ download_status: 'pending', download_progress: 45 });

      proc.emit('close', null);
      expect(await done).toBeInstanceOf(Error);
    });
  }

  it('video: a process exit flushes the last throttled value', async () => {
    cases[0]!.seed();
    const done = cases[0]!.start().catch((err) => err);
    await until(() => children.find((ch) => !ch.args.includes('--get-comments')));
    const proc = children.find((ch) => !ch.args.includes('--get-comments'))!.child;
    proc.stdout.emit('data', Buffer.from(line(10)));
    proc.stdout.emit('data', Buffer.from(line(77)));
    proc.emit('close', 1);
    await done;
    expect((db.prepare("SELECT download_progress FROM videos WHERE id = 'x1'").get() as any).download_progress).toBe(77);
  });
});

describe('podcast progress is throttled to one write per second', () => {
  it('first chunk at once, then once per second, pause flushes, nothing after', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Show' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'downloading' });
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { push = controller; } });
    safeUrlDeps.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    vi.stubGlobal('fetch', async () => new Response(body, { headers: { 'content-type': 'audio/mpeg', 'content-length': '100' } }));
    const row = () => db.prepare("SELECT download_status, download_progress FROM podcast_episodes WHERE id = 'e1'").get() as { download_status: string; download_progress: number };

    const done = downloadEpisodeFile('e1', 's1').catch((err) => err);
    const send = async (n: number) => { push.enqueue(new Uint8Array(n)); for (let i = 0; i < 5; i++) await tick(); };

    vi.advanceTimersByTime(1000); // some time elapsed, so a speed exists
    await send(10);
    await until(() => row().download_progress === 10);
    await send(10);
    await send(10);
    expect(row().download_progress).toBe(10);
    vi.advanceTimersByTime(1000);
    expect(row().download_progress).toBe(30);

    vi.advanceTimersByTime(1000);
    await send(10);
    await send(10);
    expect(row().download_progress).toBe(40);
    cancelPodcastDownload('e1', 'pending', true);
    expect(row()).toEqual({ download_status: 'pending', download_progress: 50 });

    await send(10);
    vi.advanceTimersByTime(5000);
    expect(row()).toEqual({ download_status: 'pending', download_progress: 50 });

    push.error(new Error('aborted'));
    expect(await done).toBeInstanceOf(Error);
  });
});
