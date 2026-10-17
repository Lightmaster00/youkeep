import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('search engine exclusion', () => {
  it('robots.txt disallows everything', () => {
    const lines = read('public/robots.txt').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(lines).toEqual(['User-agent: *', 'Disallow: /']);
  });

  it('every page carries a noindex robots meta', () => {
    expect(read('nuxt.config.ts')).toMatch(/name: 'robots', content: 'noindex/);
  });
});
