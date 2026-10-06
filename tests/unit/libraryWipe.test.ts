import { describe, it, expect } from 'vitest';
import { buildWipeReport } from '../../server/utils/libraryWipe';

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
