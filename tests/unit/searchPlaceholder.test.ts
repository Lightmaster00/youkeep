import { describe, it, expect } from 'vitest';
import { searchPlaceholder } from '../../app/utils/searchPlaceholder';

describe('searchPlaceholder', () => {
  it('follows the active space', () => {
    expect(searchPlaceholder('video')).toBe('Search videos, channels...');
    expect(searchPlaceholder('music')).toBe('Search artists, albums, tracks...');
    expect(searchPlaceholder('podcasts')).toBe('Search podcasts and episodes...');
  });
  it('falls back to the video wording for unknown spaces', () => {
    expect(searchPlaceholder('nope')).toBe('Search videos, channels...');
  });
});
