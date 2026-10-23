import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { assertInTmp, createTestDb, insertChannel, insertVideo } from '../helpers/testDb';
import {
  CHANNEL_CATEGORY_MIN_SHARE,
  MAX_AUTO_CATEGORIES,
  ensureChannelCategories,
  recomputeChannelCategories,
  sanitizeCategoryOverride,
} from '../../server/utils/channelCategories';

// Automatic channel categories: the YouTube categories covering at least 15 %
// of a channel's enriched videos, most frequent first (ties alphabetical), at
// most 3, recomputed set-based.
let db: Database.Database;
let n = 0;

const cats = (id: string) => {
  const row = db.prepare('SELECT categories FROM channels WHERE id = ?').get(id) as { categories: string | null };
  return row.categories === null ? null : JSON.parse(row.categories);
};
/** Adds `count` enriched videos of `channelId` with these categories. */
const add = (channelId: string, count: number, categories: string[], enriched = true) => {
  for (let i = 0; i < count; i++) {
    insertVideo(db, { id: `v${n++}`, channelId, categories, metadataEnrichedAt: enriched ? 1 : null });
  }
};

beforeEach(() => {
  db = createTestDb();
  n = 0;
  for (const id of ['a', 'b', 'c']) insertChannel(db, { id });
});

describe('recomputeChannelCategories', () => {
  it('keeps the categories covering at least 15 % of the enriched videos, most frequent first', () => {
    expect(CHANNEL_CATEGORY_MIN_SHARE).toBe(0.15);
    add('a', 14, ['Gaming']);
    add('a', 3, ['Education']); // 3/20 = 15 %: kept
    add('a', 2, ['Comedy']); // 2/20 = 10 %: dropped
    add('a', 1, []);
    recomputeChannelCategories(db);
    expect(cats('a')).toEqual(['Gaming', 'Education']);
  });

  it('just under the threshold is dropped', () => {
    add('a', 18, ['Gaming']);
    add('a', 2, ['Music']); // 2/21 < 15 %
    add('a', 1, []);
    add('b', 17, ['Gaming']);
    add('b', 3, ['Music']); // 3/20 = 15 %
    recomputeChannelCategories(db);
    expect(cats('a')).toEqual(['Gaming']);
    expect(cats('b')).toEqual(['Gaming', 'Music']);
  });

  it('ties are alphabetical and at most 3 are kept', () => {
    expect(MAX_AUTO_CATEGORIES).toBe(3);
    add('a', 2, ['Music']);
    add('a', 2, ['Gaming']);
    add('a', 2, ['Comedy']);
    add('a', 2, ['Education']);
    recomputeChannelCategories(db);
    expect(cats('a')).toEqual(['Comedy', 'Education', 'Gaming']);
  });

  it('only counts enriched videos', () => {
    add('a', 2, ['Gaming']);
    add('a', 10, ['Music'], false);
    recomputeChannelCategories(db);
    expect(cats('a')).toEqual(['Gaming']);
  });

  it('a channel without enriched videos gets an empty list', () => {
    add('b', 3, ['Music'], false);
    db.prepare(`UPDATE channels SET categories = '["Stale"]' WHERE id = 'a'`).run();
    recomputeChannelCategories(db);
    expect(cats('a')).toEqual([]);
    expect(cats('b')).toEqual([]);
  });

  it('with channel ids, only those channels change', () => {
    add('a', 2, ['Gaming']);
    add('b', 2, ['Music']);
    recomputeChannelCategories(db, 'a');
    expect(cats('a')).toEqual(['Gaming']);
    expect(cats('b')).toBeNull();
    recomputeChannelCategories(db, ['b', 'c']);
    expect(cats('b')).toEqual(['Music']);
    expect(cats('c')).toEqual([]);
  });

  it('ignores malformed category lists', () => {
    add('a', 2, ['Gaming']);
    insertVideo(db, { id: 'bad', channelId: 'a', metadataEnrichedAt: 1 });
    db.prepare(`UPDATE videos SET categories = 'not json' WHERE id = 'bad'`).run();
    recomputeChannelCategories(db);
    expect(cats('a')).toEqual(['Gaming']);
  });

  it('never touches the override', () => {
    add('a', 2, ['Gaming']);
    db.prepare(`UPDATE channels SET categories_override = '["Mine"]' WHERE id = 'a'`).run();
    recomputeChannelCategories(db);
    expect(cats('a')).toEqual(['Gaming']);
    expect((db.prepare("SELECT categories_override FROM channels WHERE id = 'a'").get() as any).categories_override).toBe('["Mine"]');
  });
});

describe('ensureChannelCategories (startup and one-off migration)', () => {
  it('the first run computes every channel once, then only channels still NULL that have enriched videos', () => {
    add('a', 2, ['Gaming']);
    ensureChannelCategories(db);
    expect([cats('a'), cats('b'), cats('c')]).toEqual([['Gaming'], [], []]);
    // Later: a channel left NULL with enriched videos is filled at startup,
    // one already computed is not recomputed.
    insertChannel(db, { id: 'd' });
    add('d', 1, ['Music']);
    insertChannel(db, { id: 'e' });
    add('b', 4, ['Comedy']);
    ensureChannelCategories(db);
    expect(cats('d')).toEqual(['Music']);
    expect(cats('e')).toBeNull();
    expect(cats('b')).toEqual([]);
  });

  it('runs on the real schema (openDatabase): the migration fills channels of an existing database', async () => {
    const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-channel-cats-'));
    assertInTmp(dir);
    try {
      const file = path.join(dir, 'youkeep.db');
      const first = openDatabase(file);
      first.prepare("INSERT INTO channels (id, title, created_at) VALUES ('x', 'X', 0)").run();
      first.prepare(`INSERT INTO videos (id, title, channel_id, download_status, categories, metadata_enriched_at, created_at) VALUES ('xv', 'V', 'x', 'completed', '["Gaming"]', 1, 0)`).run();
      // As before this feature: nothing computed, migration not done.
      first.prepare('UPDATE channels SET categories = NULL').run();
      first.prepare("DELETE FROM settings WHERE key = 'channel_categories_migrated'").run();
      first.close();
      const second = openDatabase(file);
      expect((second.prepare("SELECT categories FROM channels WHERE id = 'x'").get() as any).categories).toBe('["Gaming"]');
      second.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});

describe('sanitizeCategoryOverride', () => {
  it('trims, drops duplicates (case-insensitive) and empty names', () => {
    expect(sanitizeCategoryOverride(['  Gaming ', 'gaming', 'Music', ''])).toEqual(['Gaming', 'Music']);
  });

  it('null clears the override', () => {
    expect(sanitizeCategoryOverride(null)).toBeNull();
  });

  it.each([
    ['not an array', 'Gaming'],
    ['more than 5', ['a', 'b', 'c', 'd', 'e', 'f']],
    ['a name over 40 characters', ['x'.repeat(41)]],
    ['a control character', ['Gam\u0007ing']],
    ['a non-string', [42]],
  ])('rejects %s', (_label, input) => {
    expect(() => sanitizeCategoryOverride(input as any)).toThrow();
  });

  it('accepts exactly 5 names of 40 characters', () => {
    const names = ['a', 'b', 'c', 'd', 'e'].map((c) => c.repeat(40));
    expect(sanitizeCategoryOverride(names)).toEqual(names);
  });
});

afterEach(() => {
  try { db.close(); } catch {}
});
