import { describe, it, expect, vi } from 'vitest';

const tidy = vi.hoisted(() => ({ running: false }));
vi.mock('../../server/utils/videoTidy', () => ({ isTidyRunning: () => tidy.running }));

import { buildWipeReport, startLibraryWipe, isWipeInProgress } from '../../server/utils/libraryWipe';

describe('buildWipeReport', () => {
  it('returns empty succeeded/failed for an empty outcome list', () => {
    expect(buildWipeReport([])).toEqual({ succeeded: [], failed: [] });
  });

  it('splits successes (error field stripped) and failures (error kept), in original order within each bucket', () => {
    const result = buildWipeReport([
      { type: 'channel' as const, id: 'c1', name: 'Channel One' },
      { type: 'artist' as const, id: 'a1', name: 'Artist One', error: 'permission denied' },
      { type: 'show' as const, id: 's1', name: 'Show One' },
      { type: 'channel' as const, id: 'c2', name: 'Channel Two', error: 'not found' },
    ]);
    expect(result).toEqual({
      succeeded: [
        { type: 'channel', id: 'c1', name: 'Channel One' },
        { type: 'show', id: 's1', name: 'Show One' },
      ],
      failed: [
        { type: 'artist', id: 'a1', name: 'Artist One', error: 'permission denied' },
        { type: 'channel', id: 'c2', name: 'Channel Two', error: 'not found' },
      ],
    });
  });
});

describe('startLibraryWipe', () => {
  it('refuses to start while library tidying runs, without flagging a wipe', () => {
    tidy.running = true;
    expect(startLibraryWipe()).toEqual({ started: false, error: expect.stringContaining('tidying') });
    expect(isWipeInProgress()).toBe(false);
    tidy.running = false;
  });
});
