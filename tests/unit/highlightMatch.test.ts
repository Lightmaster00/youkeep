import { describe, it, expect } from 'vitest';
import { highlightMatch } from '../../app/utils/highlightMatch';

describe('highlightMatch', () => {
  it('wraps only the first case-insensitive match in <mark>', () => {
    expect(highlightMatch('Hello World', 'world')).toBe('Hello <mark>World</mark>');
    expect(highlightMatch('cat cat cat', 'cat')).toBe('<mark>cat</mark> cat cat');
  });

  it('escapes HTML in matched and unmatched portions, with or without a match', () => {
    expect(highlightMatch('<script>alert(1)</script> World', 'world')).toBe('&lt;script&gt;alert(1)&lt;/script&gt; <mark>World</mark>');
    expect(highlightMatch('A & B < C', 'b')).toBe('A &amp; <mark>B</mark> &lt; C');
    expect(highlightMatch('<b>Bold</b> & stuff', 'zzz')).toBe('&lt;b&gt;Bold&lt;/b&gt; &amp; stuff');
    expect(highlightMatch('Some Title', '')).toBe('Some Title');
  });

  it('treats regex-special characters in the query as literal text', () => {
    expect(highlightMatch('Price: $5.00 (each)', '$5.00')).toBe('Price: <mark>$5.00</mark> (each)');
    expect(highlightMatch('a.b.c', '.')).toBe('a<mark>.</mark>b.c');
    expect(highlightMatch('axbxc', '.')).toBe('axbxc');
    expect(highlightMatch('3 * 4 = 12', '*')).toBe('3 <mark>*</mark> 4 = 12');
  });

  it('prefers the whole phrase, else highlights each present word separately', () => {
    expect(highlightMatch('big rock roll band', 'rock roll')).toBe('big <mark>rock roll</mark> band');
    expect(highlightMatch('Rock & Roll', 'rock roll')).toBe('<mark>Rock</mark> &amp; <mark>Roll</mark>');
    expect(highlightMatch('Rock & Roll', 'rock zzz')).toBe('<mark>Rock</mark> &amp; Roll');
  });

  it('matches the raw text, never inside an escaped entity', () => {
    expect(highlightMatch('Guitar & Amp', 'amp')).toBe('Guitar &amp; <mark>Amp</mark>');
    expect(highlightMatch('a < b > c', 'lt')).toBe('a &lt; b &gt; c');
    expect(highlightMatch('say "hi"', 'quot')).toBe('say &quot;hi&quot;');
    expect(highlightMatch('Tom & Jerry', '&')).toBe('Tom <mark>&amp;</mark> Jerry');
    expect(highlightMatch('x<y', '<')).toBe('x<mark>&lt;</mark>y');
  });

  it('escapes quotes and apostrophes so the output is safe anywhere', () => {
    expect(highlightMatch(`It's "quoted"`, 'quoted')).toBe('It&#39;s &quot;<mark>quoted</mark>&quot;');
    expect(highlightMatch(`<img src=x onerror="alert(1)">`, 'img')).toBe('&lt;<mark>img</mark> src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(highlightMatch(`'"><svg onload=alert(2)>`, 'svg')).not.toMatch(/<svg/);
  });

  it('handles unicode and regex metacharacters', () => {
    expect(highlightMatch('Café Ünïcode 😀 fun', 'ünï')).toBe('Café <mark>Ünï</mark>code 😀 fun');
    expect(highlightMatch('Smile 😀 now', '😀')).toBe('Smile <mark>😀</mark> now');
    expect(highlightMatch('a+b (c) [d] {e} ^f$ g|h \\ i?', '(c) [d]')).toBe('a+b <mark>(c) [d]</mark> {e} ^f$ g|h \\ i?');
    expect(highlightMatch('back\\slash', '\\')).toBe('back<mark>\\</mark>slash');
  });
});
