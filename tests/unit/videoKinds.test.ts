import { describe, it, expect } from 'vitest';
import { splitShorts } from '../../app/utils/videoKinds';

describe('splitShorts', () => {
  it('puts long videos and Shorts in two lists, each keeping the original order', () => {
    const list = [
      { id: 'a', is_short: 0 }, { id: 's1', is_short: 1 }, { id: 'b' }, { id: 's2', is_short: true }, { id: 'c', is_short: null },
    ];
    const { videos, shorts } = splitShorts(list);
    expect(videos.map((v) => v.id)).toEqual(['a', 'b', 'c']);
    expect(shorts.map((v) => v.id)).toEqual(['s1', 's2']);
  });

  it('handles an empty or missing list', () => {
    expect(splitShorts([])).toEqual({ videos: [], shorts: [] });
    expect(splitShorts(undefined)).toEqual({ videos: [], shorts: [] });
  });
});
