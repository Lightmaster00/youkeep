import { describe, it, expect } from 'vitest';
import {
  isValidMediaId, validatePlaylistFields, isPermutationOf, moveItem,
  PLAYLIST_TITLE_MAX, PLAYLIST_DESCRIPTION_MAX,
} from '../../shared/musicPlaylists';

describe('isValidMediaId', () => {
  it('accepts YouTube ids and UUIDs, rejects anything else', () => {
    expect(isValidMediaId('dQw4w9WgXcQ')).toBe(true);
    expect(isValidMediaId('3f1c2a9e-0b6d-4c1e-9a43-1b2c3d4e5f60')).toBe(true);
    for (const bad of ['', 'a/b', 'a b', '../x', 'x'.repeat(129), 12, null, undefined]) {
      expect(isValidMediaId(bad)).toBe(false);
    }
    expect(isValidMediaId('x'.repeat(128))).toBe(true);
  });
});

describe('validatePlaylistFields', () => {
  it('requires a trimmed 1-100 character title on create', () => {
    expect(validatePlaylistFields({ title: '  Road trip  ' }, false)).toEqual({ ok: true, fields: { title: 'Road trip' } });
    expect(validatePlaylistFields({}, false)).toMatchObject({ ok: false });
    expect(validatePlaylistFields(null, false)).toMatchObject({ ok: false });
    expect(validatePlaylistFields({ title: '   ' }, false)).toMatchObject({ ok: false, error: 'Title is required.' });
    expect(validatePlaylistFields({ title: 5 }, false)).toMatchObject({ ok: false });
    expect(validatePlaylistFields({ title: 'x'.repeat(PLAYLIST_TITLE_MAX) }, false)).toMatchObject({ ok: true });
    expect(validatePlaylistFields({ title: ` ${'x'.repeat(PLAYLIST_TITLE_MAX)} ` }, false)).toMatchObject({ ok: true });
    expect(validatePlaylistFields({ title: 'x'.repeat(PLAYLIST_TITLE_MAX + 1) }, false)).toMatchObject({ ok: false });
  });

  it('accepts a description up to 500 characters; empty or null clears it', () => {
    expect(validatePlaylistFields({ title: 'A', description: ' Chill ' }, false)).toEqual({ ok: true, fields: { title: 'A', description: 'Chill' } });
    expect(validatePlaylistFields({ title: 'A', description: '' }, false)).toEqual({ ok: true, fields: { title: 'A', description: null } });
    expect(validatePlaylistFields({ description: null }, true)).toEqual({ ok: true, fields: { description: null } });
    expect(validatePlaylistFields({ title: 'A', description: 'x'.repeat(PLAYLIST_DESCRIPTION_MAX) }, false)).toMatchObject({ ok: true });
    expect(validatePlaylistFields({ title: 'A', description: 'x'.repeat(PLAYLIST_DESCRIPTION_MAX + 1) }, false)).toMatchObject({ ok: false });
    expect(validatePlaylistFields({ title: 'A', description: 3 }, false)).toMatchObject({ ok: false });
  });

  it('on update only validates the fields that are present', () => {
    expect(validatePlaylistFields({}, true)).toEqual({ ok: true, fields: {} });
    expect(validatePlaylistFields({ title: ' B ' }, true)).toEqual({ ok: true, fields: { title: 'B' } });
    expect(validatePlaylistFields({ title: '' }, true)).toMatchObject({ ok: false });
  });
});

describe('isPermutationOf', () => {
  it('accepts the same ids in any order, each exactly once', () => {
    expect(isPermutationOf(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(isPermutationOf([], [])).toBe(true);
  });

  it('rejects missing, extra, duplicated or foreign ids', () => {
    expect(isPermutationOf(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    expect(isPermutationOf(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    expect(isPermutationOf(['a', 'b', 'c'], ['a', 'a', 'b'])).toBe(false);
    expect(isPermutationOf(['a', 'b', 'c'], ['a', 'b', 'd'])).toBe(false);
    expect(isPermutationOf(['a', 'b'], ['a', 1])).toBe(false);
    expect(isPermutationOf(['a', 'b'], 'ab')).toBe(false);
  });
});

describe('moveItem', () => {
  it('moves one item up or down without mutating the input', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('leaves the order unchanged when the move would leave the list', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 5, -1)).toEqual(['a', 'b']);
  });
});
