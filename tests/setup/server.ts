import { vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTestDb } from '../helpers/testDb';

// The app's local data folder (yt-dlp binary, fallback download folders for
// videos, music and podcasts) is a temporary one in tests, never ./data.
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-test-data-'));
process.env.YOUKEEP_DATA_DIR = testDataDir;
process.on('exit', () => {
  try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch {}
});

// The real server/utils/db opens data/youkeep.db, whose settings point at the
// developer's real media. No server test may ever reach it: every getDb()
// goes through the ambient one each test sets, and a test that forgot to set
// one gets a fresh test database (default downloads folder in a temp dir).
vi.mock('../../server/utils/db', () => ({
  getDb: () => (globalThis as any).getDb(),
}));

if (typeof (globalThis as any).getDb !== 'function') {
  const fallback = createTestDb();
  (globalThis as any).getDb = () => fallback;
}
