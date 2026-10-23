import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every number/date formatting call names its locale, never the implicit
// default, so the browser language cannot leak in and SSR/CSR agree (#36).
// The locale is either 'en-US' (English-only admin screens) or the UI locale
// from useI18n() (`locale`, `locale.value`, `uiLocale`) for user-facing text.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.(vue|ts)$/.test(name) ? [full] : [];
  });
}

// First argument must be 'en-US', ['en'], or the UI locale (locale / uiLocale, optionally .value).
export function explicitLocale(call: string): boolean {
  return /\(\s*(?:'en-US'|"en-US"|\['en'\]|\["en"\]|(?:locale|uiLocale)(?:\.value)?\s*[,)])/.test(call);
}

describe('explicit locale', () => {
  it('the guard itself (self-test)', () => {
    expect(explicitLocale("d.toLocaleDateString('en-US', {})")).toBe(true);
    expect(explicitLocale('d.toLocaleDateString(locale.value, {})')).toBe(true);
    expect(explicitLocale('n.toLocaleString(uiLocale)')).toBe(true);
    expect(explicitLocale('new Intl.NumberFormat(locale.value)')).toBe(true);
    expect(explicitLocale('d.toLocaleDateString(undefined, {})')).toBe(false);
    expect(explicitLocale('d.toLocaleDateString()')).toBe(false);
    expect(explicitLocale('d.toLocaleDateString(navigator.language)')).toBe(false);
    expect(explicitLocale('d.toLocaleDateString(localeFoo)')).toBe(false);
  });

  it('every toLocale*() and Intl formatter in app/ names an explicit locale', () => {
    const offenders: string[] = [];
    for (const file of filesUnder(join(ROOT, 'app'))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const calls = line.match(/toLocale(?:String|DateString|TimeString)\([^)]*\)?|Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|DisplayNames)\([^)]*\)?/g) || [];
        for (const call of calls) {
          if (!explicitLocale(call)) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${call}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
