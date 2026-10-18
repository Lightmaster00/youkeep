import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The UI is English: every number/date formatting call names its locale, so
// a French browser does not get "1 234" (and SSR/CSR agree) (#36).
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.(vue|ts)$/.test(name) ? [full] : [];
  });
}

describe('explicit locale', () => {
  it('every toLocale*() and Intl formatter in app/ names an English locale', () => {
    const offenders: string[] = [];
    for (const file of filesUnder(join(ROOT, 'app'))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const calls = line.match(/toLocale(?:String|DateString|TimeString)\([^)]*\)?|Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|DisplayNames)\([^)]*\)?/g) || [];
        for (const call of calls) {
          if (!/'en-US'|"en-US"|\['en'\]|\["en"\]/.test(call)) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${call}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
