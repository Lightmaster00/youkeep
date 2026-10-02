import { describe, it, expect } from 'vitest';
import { highlightMatch } from '../../app/utils/highlightMatch';

describe('highlightMatch', () => {
  it('wraps a case-insensitive match in <mark>', () => {
    expect(highlightMatch('Hello World', 'world')).toBe('Hello <mark>World</mark>');
  });

  it('escapes HTML in the source text before highlighting', () => {
    expect(highlightMatch('<script>alert(1)</script> World', 'world')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; <mark>World</mark>'
    );
  });

  it('escapes HTML in the source text even when there is no match', () => {
    expect(highlightMatch('<b>Bold</b> & stuff', 'zzz')).toBe('&lt;b&gt;Bold&lt;/b&gt; &amp; stuff');
  });

  it('escapes &, <, > in both matched and unmatched portions', () => {
    expect(highlightMatch('A & B < C', 'b')).toBe('A &amp; <mark>B</mark> &lt; C');
  });

  it('returns the escaped text unchanged when there is no match', () => {
    expect(highlightMatch('Nothing matches here', 'zzz')).toBe('Nothing matches here');
  });

  it('returns the escaped text unchanged when the query is empty', () => {
    expect(highlightMatch('Some Title', '')).toBe('Some Title');
  });

  it('treats regex-special characters in the query as literal text', () => {
    expect(highlightMatch('Price: $5.00 (each)', '$5.00')).toBe('Price: <mark>$5.00</mark> (each)');
  });

  it('matches a literal "." character only, not as a wildcard', () => {
    expect(highlightMatch('a.b.c', '.')).toBe('a<mark>.</mark>b.c');
    expect(highlightMatch('axbxc', '.')).toBe('axbxc');
  });

  it('matches a literal "*" character only, not as a repetition operator', () => {
    expect(highlightMatch('3 * 4 = 12', '*')).toBe('3 <mark>*</mark> 4 = 12');
  });

  it('only wraps the first matching occurrence', () => {
    expect(highlightMatch('cat cat cat', 'cat')).toBe('<mark>cat</mark> cat cat');
  });

  it('highlights each word separately when the whole phrase does not appear contiguously', () => {
    expect(highlightMatch('Rock & Roll', 'rock roll')).toBe('<mark>Rock</mark> &amp; <mark>Roll</mark>');
  });

  it('highlights only the words that are present in the multi-word fallback', () => {
    expect(highlightMatch('Rock & Roll', 'rock zzz')).toBe('<mark>Rock</mark> &amp; Roll');
  });

  it('still prefers the whole phrase when it appears contiguously', () => {
    expect(highlightMatch('big rock roll band', 'rock roll')).toBe('big <mark>rock roll</mark> band');
  });
});
