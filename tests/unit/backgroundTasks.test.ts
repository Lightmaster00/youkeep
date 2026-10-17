import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { runSyncAllEntities } from '../../server/utils/concurrency';
import { runInBackground } from '../../server/utils/background';
import { createTestDb } from '../helpers/testDb';

afterEach(() => { vi.restoreAllMocks(); });

function collectUnhandled() {
  const seen: unknown[] = [];
  const handler = (reason: unknown) => { seen.push(reason); };
  process.on('unhandledRejection', handler);
  return { seen, stop: () => process.off('unhandledRejection', handler) };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('runSyncAllEntities with a database closed under it', () => {
  it('resolves (no rejection) when the database is closed while an entity runs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = createTestDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('sync_all_active', '0'), ('downloader_paused', '0')").run();
    await expect(runSyncAllEntities({
      db,
      activeFlagSettingKey: 'sync_all_active',
      pausedSettingKey: 'downloader_paused',
      fetchEntities: () => [1, 2],
      processEntity: async () => { db.close(); },
      onStart: () => {},
      onPaused: () => {},
      onComplete: () => {},
      onFatalError: () => {},
      startWorker: () => {},
    })).resolves.toBeUndefined();
  });
});

describe('runInBackground', () => {
  it('logs a rejected task instead of leaving an unhandled rejection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const watcher = collectUnhandled();
    runInBackground('test task', () => Promise.reject(new Error('boom')));
    runInBackground('test promise', Promise.reject(new Error('boom2')));
    runInBackground('sync throw', () => { throw new Error('boom3'); });
    await tick();
    watcher.stop();
    expect(watcher.seen).toEqual([]);
    expect(error).toHaveBeenCalledTimes(3);
    expect(error.mock.calls.map((c) => String(c[0]))).toEqual(expect.arrayContaining([expect.stringContaining('test task'), expect.stringContaining('test promise')]));
  });
});

// Every async function exported by server/utils, called as a bare statement
// (no await, return, assignment, .then/.catch or runInBackground): a rejection
// there would be unhandled.
describe('no fire-and-forget async call in server/**', () => {
  it('every background start goes through runInBackground or handles its rejection', () => {
    const root = path.resolve(__dirname, '../../server');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    const asyncNames = new Set<string>();
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:export\s+)?async\s+function\s+(\w+)/g)) asyncNames.add(m[1]!);
    }
    const offenders: string[] = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = line.match(/^\s*(?:void\s+)?(\w+)\([^;]*\);?\s*(?:\/\/.*)?$/);
        if (!m || !asyncNames.has(m[1]!) || /\.catch\(/.test(line)) return;
        // A call whose next line chains .then/.catch is handled.
        if (/^\s*\.(then|catch)\(/.test(lines[i + 1] ?? '')) return;
        offenders.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
