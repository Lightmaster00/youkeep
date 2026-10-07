import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Nuxt auto-imports every export of server/utils. Two files exporting the same
// name make the auto-import ambiguous (`WARN Duplicated imports "<name>"`):
// one of them silently wins. Each exported name must come from one file only.
describe('server/utils auto-imports', () => {
  it('no name is exported by two files', () => {
    const dir = path.resolve(__dirname, '../../server/utils');
    const owners = new Map<string, string[]>();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|interface|type|class|enum)\s+([A-Za-z0-9_$]+)/gm)) {
        owners.set(m[1]!, [...(owners.get(m[1]!) ?? []), file]);
      }
    }
    const duplicated = [...owners].filter(([, files]) => files.length > 1).map(([name, files]) => `${name}: ${files.join(', ')}`);
    expect(duplicated).toEqual([]);
  });
});
