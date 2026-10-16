import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Nuxt auto-imports server/utils into the server bundle, but not into tests
// nor into code a test drives (queue workers, wipe): a util that calls
// another util's function without importing it fails there with
// "X is not defined", which a worker loop then swallows. Every util must
// import what it calls. getDb is the one exception: tests replace it globally.
const ALLOWED_GLOBALS = new Set(['getDb']);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('server/utils imports', () => {
  it('every util imports the other utils it calls', () => {
    const dir = path.resolve(__dirname, '../../server/utils');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    const owner = new Map<string, string>();
    for (const f of files) {
      const source = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm)) owner.set(m[1]!, f);
    }
    const missing: string[] = [];
    for (const f of files) {
      const source = stripComments(fs.readFileSync(path.join(dir, f), 'utf8'));
      const imported = new Set<string>();
      for (const m of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}/g)) {
        for (const part of m[1]!.split(',')) imported.add(part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()!);
      }
      const local = new Set<string>();
      for (const m of source.matchAll(/(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) local.add(m[1]!);
      for (const [name, of] of owner) {
        if (of === f || imported.has(name) || local.has(name) || ALLOWED_GLOBALS.has(name)) continue;
        if (new RegExp(`(?<![\\w.$])${name.replace(/\$/g, '\\$')}\\s*\\(`).test(source)) missing.push(`${f} calls ${name} (from ${of}) without importing it`);
      }
    }
    expect(missing).toEqual([]);
  });
});
