import { vi } from 'vitest';
import { createTestDb } from '../helpers/testDb';

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
