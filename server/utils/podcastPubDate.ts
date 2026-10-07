import type Database from 'better-sqlite3';

// podcast_episodes.pub_date is the raw RSS string; pub_ts is the same instant
// as epoch milliseconds so lists can be ordered by real publish date.
export function parsePubTs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : null;
}

const BACKFILL_FLAG = 'podcast_pub_ts_backfilled';

// Idempotent migration: adds pub_ts and its index, then fills it for rows that
// have a pub_date but no pub_ts yet. The backfill runs once per database: a
// settings flag is written in the same transaction, so later startups skip the
// scan (ingest sets pub_ts for every new or refreshed row, and rows whose date
// is unparsable would otherwise be re-read at every start for nothing).
export function ensurePodcastPubTs(db: Database.Database): void {
  try { db.exec('ALTER TABLE podcast_episodes ADD COLUMN pub_ts INTEGER;'); } catch (e) {}
  db.exec('CREATE INDEX IF NOT EXISTS idx_podcast_episodes_pub_ts ON podcast_episodes(pub_ts);');
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(BACKFILL_FLAG)) return;
  const rows = db.prepare('SELECT id, pub_date FROM podcast_episodes WHERE pub_ts IS NULL AND pub_date IS NOT NULL').all() as { id: string; pub_date: string }[];
  const update = db.prepare('UPDATE podcast_episodes SET pub_ts = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of rows) {
      const ts = parsePubTs(row.pub_date);
      if (ts !== null) update.run(ts, row.id);
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").run(BACKFILL_FLAG);
  })();
}
