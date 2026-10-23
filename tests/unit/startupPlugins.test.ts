import { describe, it, expect, beforeEach, vi } from 'vitest';

// The Nitro startup plugins with every collaborator recorded: interrupted
// downloads must be reset to 'pending' before any queue worker starts, and the
// session purge timer must stop with the server.
const calls: string[] = [];
const rec = (name: string, result?: unknown) => vi.fn(() => { calls.push(name); return result; });
let releaseUpdate: () => void = () => {};

vi.mock('nitropack/dist/runtime/plugin', () => ({ defineNitroPlugin: (fn: any) => fn }));
vi.mock('../../server/utils/db', () => ({ getDb: () => ({}) }));
vi.mock('../../server/utils/downloader', () => ({
  initScheduler: rec('initScheduler'),
  resetStaleDownloads: rec('resetStaleDownloads'),
  startQueueWorker: rec('startQueueWorker'),
  updateYtdl: vi.fn(() => { calls.push('updateYtdl'); return new Promise<void>((r) => { releaseUpdate = r; }); }),
  resumeInterruptedChannelImports: rec('resumeInterruptedChannelImports'),
  syncAllChannels: rec('syncAllChannels'),
  getDownloadsDirState: () => ({ blockedReason: null }),
}));
vi.mock('../../server/utils/musicDownloader', () => ({
  resetStaleMusicDownloads: rec('resetStaleMusicDownloads'),
  startMusicQueueWorker: rec('startMusicQueueWorker'),
  initMusicScheduler: rec('initMusicScheduler'),
  resumeInterruptedArtistImports: rec('resumeInterruptedArtistImports'),
  syncAllMusicArtists: rec('syncAllMusicArtists'),
}));
vi.mock('../../server/utils/podcastDownloader', () => ({
  resetStalePodcastDownloads: rec('resetStalePodcastDownloads'),
  startPodcastQueueWorker: rec('startPodcastQueueWorker'),
  initPodcastScheduler: rec('initPodcastScheduler'),
  syncAllPodcastShows: rec('syncAllPodcastShows'),
}));
vi.mock('../../server/utils/videoDurations', () => ({
  backfillMissingVideoDurations: vi.fn(async () => ({ checked: 0, updated: 0 })),
  backfillMissingVideoSizes: vi.fn(async () => ({ checked: 0, updated: 0 })),
}));
vi.mock('../../server/utils/albumMatchRunner', () => ({ scheduleStartupAlbumMatch: rec('scheduleStartupAlbumMatch') }));
vi.mock('../../server/utils/metadataBackfill', () => ({ scheduleStartupMetadataBackfill: rec('scheduleStartupMetadataBackfill') }));
vi.mock('../../server/utils/thumbnails', () => ({ sweepThumbCache: rec('sweepThumbCache', 0), startThumbCacheSweep: vi.fn(() => () => {}) }));
vi.mock('../../server/utils/concurrency', () => ({ resetSyncAllFlags: rec('resetSyncAllFlags') }));
let catchUpDeps: any = null;
vi.mock('../../server/utils/autoSync', () => ({
  scheduleStartupCatchUp: vi.fn((deps: any) => { calls.push('scheduleStartupCatchUp'); catchUpDeps = deps; return () => calls.push('cancelStartupCatchUp'); }),
}));
vi.mock('../../server/utils/background', () => ({ runInBackground: (name: string, fn: () => unknown) => { calls.push(`bg:${name}`); fn(); } }));
vi.mock('../../server/utils/auth', () => ({ startSessionCleanup: vi.fn(() => { calls.push('startSessionCleanup'); return () => calls.push('stopSessionCleanup'); }) }));

const scheduler = (await import('../../server/plugins/scheduler')).default as any;
const sessionCleanup = (await import('../../server/plugins/sessionCleanup')).default as any;

function fakeNitro() {
  const hooks: Record<string, (() => unknown)[]> = {};
  return { hooks: { hook: (name: string, fn: () => unknown) => { (hooks[name] ??= []).push(fn); } }, close: () => (hooks.close ?? []).forEach((fn) => fn()) };
}

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('scheduler plugin', () => {
  it('resets interrupted downloads and sync-all flags, then starts the workers only after the yt-dlp update settles', async () => {
    scheduler(fakeNitro());
    for (const reset of ['resetStaleDownloads', 'resetStaleMusicDownloads', 'resetStalePodcastDownloads', 'resetSyncAllFlags']) expect(calls).toContain(reset);
    expect(calls).not.toContain('startQueueWorker');
    expect(calls).not.toContain('resumeInterruptedChannelImports');

    releaseUpdate();
    await new Promise((r) => setImmediate(r));

    const at = (n: string) => calls.indexOf(n);
    for (const worker of ['startQueueWorker', 'startMusicQueueWorker', 'startPodcastQueueWorker']) {
      expect(at(worker)).toBeGreaterThan(at('resetStaleDownloads'));
      expect(at(worker)).toBeGreaterThan(at('resetStaleMusicDownloads'));
      expect(at(worker)).toBeGreaterThan(at('resetStalePodcastDownloads'));
    }
    expect(calls).toContain('resumeInterruptedChannelImports');
    expect(calls).toContain('resumeInterruptedArtistImports');
    // The video category lookup is scheduled once the workers run (it waits 120 s itself).
    expect(at('scheduleStartupMetadataBackfill')).toBeGreaterThan(at('startQueueWorker'));
  });

  it('schedules the startup catch-up after the sync-all flags are reset, with the three sync-all runners, and cancels it on close', () => {
    const nitro = fakeNitro();
    scheduler(nitro);
    expect(calls.indexOf('scheduleStartupCatchUp')).toBeGreaterThan(calls.indexOf('resetSyncAllFlags'));
    catchUpDeps.runners.video();
    catchUpDeps.runners.music();
    catchUpDeps.runners.podcast();
    expect(calls).toEqual(expect.arrayContaining(['syncAllChannels', 'syncAllMusicArtists', 'syncAllPodcastShows']));
    expect(catchUpDeps.blockedReason()).toBeNull();
    nitro.close();
    expect(calls).toContain('cancelStartupCatchUp');
  });
});

describe('session cleanup plugin', () => {
  it('starts the purge timer and stops it when the server closes', () => {
    const nitro = fakeNitro();
    sessionCleanup(nitro);
    expect(calls).toEqual(['startSessionCleanup']);
    nitro.close();
    expect(calls).toEqual(['startSessionCleanup', 'stopSessionCleanup']);
  });
});
