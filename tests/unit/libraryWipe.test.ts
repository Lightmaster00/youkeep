import { describe, it, expect } from 'vitest';
import { buildWipeReport } from '../../server/utils/libraryWipe';

describe('buildWipeReport', () => {
  it('returns empty succeeded/failed for an empty outcome list', () => {
    expect(buildWipeReport([])).toEqual({ succeeded: [], failed: [] });
  });

  it('puts an outcome with no error into succeeded, stripped of the error field', () => {
    const result = buildWipeReport([{ type: 'channel', id: 'c1', name: 'Some Channel' }]);
    expect(result).toEqual({
      succeeded: [{ type: 'channel', id: 'c1', name: 'Some Channel' }],
      failed: []
    });
  });

  it('puts an outcome with an error into failed, keeping the error message', () => {
    const result = buildWipeReport([{ type: 'artist', id: 'a1', name: 'Some Artist', error: 'disk full' }]);
    expect(result).toEqual({
      succeeded: [],
      failed: [{ type: 'artist', id: 'a1', name: 'Some Artist', error: 'disk full' }]
    });
  });

  it('splits a mixed list of successes and failures in original order within each bucket', () => {
    const outcomes = [
      { type: 'channel' as const, id: 'c1', name: 'Channel One' },
      { type: 'artist' as const, id: 'a1', name: 'Artist One', error: 'permission denied' },
      { type: 'show' as const, id: 's1', name: 'Show One' },
      { type: 'channel' as const, id: 'c2', name: 'Channel Two', error: 'not found' },
    ];
    const result = buildWipeReport(outcomes);
    expect(result.succeeded).toEqual([
      { type: 'channel', id: 'c1', name: 'Channel One' },
      { type: 'show', id: 's1', name: 'Show One' },
    ]);
    expect(result.failed).toEqual([
      { type: 'artist', id: 'a1', name: 'Artist One', error: 'permission denied' },
      { type: 'channel', id: 'c2', name: 'Channel Two', error: 'not found' },
    ]);
  });
});
