import { describe, it, expect } from 'vitest';
import { buildFtsQuery, FTS_MAX_QUERY_CHARS, FTS_MAX_TOKENS } from '../../server/utils/ftsQuery';

describe('buildFtsQuery', () => {
  it('quotes every word and adds a prefix * only from 2 characters', () => {
    expect(buildFtsQuery('daft punk a').match).toBe('"daft"* AND "punk"* AND "a"');
  });

  it('keeps at most 8 words and drops duplicates (case-insensitive)', () => {
    const r = buildFtsQuery('one two Two three four five six seven eight nine ten');
    expect(FTS_MAX_TOKENS).toBe(8);
    expect(r.match).toBe('"one"* AND "two"* AND "three"* AND "four"* AND "five"* AND "six"* AND "seven"* AND "eight"*');
  });

  it('caps the text at 200 characters', () => {
    expect(FTS_MAX_QUERY_CHARS).toBe(200);
    const r = buildFtsQuery('x'.repeat(5000));
    expect(r.text.length).toBe(200);
    expect(r.match).toBe(`"${'x'.repeat(200)}"*`);
  });

  it('never cuts a character in two', () => {
    const r = buildFtsQuery('é'.repeat(150) + '😀'.repeat(100));
    expect([...r.text].length).toBe(200);
    expect(r.text.endsWith('😀')).toBe(true);
  });

  it('escapes quotes and ignores tokens with no letter or digit', () => {
    expect(buildFtsQuery('say "hi" - !').match).toBe('"say"* AND """hi"""*');
    expect(buildFtsQuery(' - ').match).toBeNull();
    expect(buildFtsQuery('').match).toBeNull();
  });
});
