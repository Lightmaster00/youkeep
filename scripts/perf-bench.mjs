#!/usr/bin/env node
// Dev benchmark for the performance pass (docs/superpowers/specs/2026-10-15-performance-design.md).
// Not part of the app build. Builds a synthetic database in a temporary folder
// (10k videos with 3 KB descriptions) and measures:
//   (a) the cost of one download-progress UPDATE with the old unconditional
//       full-text trigger vs the new column-scoped one (with the old default
//       synchronous=FULL and the new synchronous=NORMAL);
//   (b) event-loop lag (perf_hooks.monitorEventLoopDelay) while a simulated
//       progress storm runs: old behaviour (one prepared-and-run UPDATE per
//       progress line) vs the real throttled progress writer.
// Usage: node scripts/perf-bench.mjs [--seconds 5]
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url);
const { FTS_UPDATE_TRIGGERS, applyPerformancePragmas } = await jiti.import(path.join(ROOT, 'server/utils/dbTuning.ts'));
const { createDbProgressWriter } = await jiti.import(path.join(ROOT, 'server/utils/progressWriter.ts'));

const secondsArg = process.argv.indexOf('--seconds');
const STORM_SECONDS = secondsArg > 0 ? Number(process.argv[secondsArg + 1]) || 5 : 5;
const VIDEO_COUNT = 10_000;
const DESCRIPTION = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(56).slice(0, 3072);
const UPDATES = 2_000;

const LEGACY_VIDEOS_AU = `
  CREATE TRIGGER videos_au AFTER UPDATE ON videos BEGIN
    DELETE FROM videos_fts WHERE rowid = old.rowid;
    INSERT INTO videos_fts(rowid, id, title, description, channel_title)
    VALUES (new.rowid, new.id, new.title, new.description, (SELECT title FROM channels WHERE id = new.channel_id));
  END;`;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-perf-bench-'));
process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

/** A database file shaped like the app's videos + full-text index, filled with the synthetic library. */
function buildDb(name, { trigger, tuned }) {
  const db = new Database(path.join(tmpRoot, `${name}.db`));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  if (tuned) applyPerformancePragmas(db); // real code: synchronous=NORMAL, cache, mmap, ...
  else db.pragma('synchronous = FULL'); // the previous default
  db.exec(`
    CREATE TABLE channels (id TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE videos (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, channel_id TEXT NOT NULL,
      download_status TEXT NOT NULL, download_progress INTEGER DEFAULT 0, download_speed TEXT, download_eta TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE videos_fts USING fts5(id UNINDEXED, title, description, channel_title, tokenize='porter');
    CREATE TRIGGER videos_ai AFTER INSERT ON videos BEGIN
      INSERT INTO videos_fts(rowid, id, title, description, channel_title)
      VALUES (new.rowid, new.id, new.title, new.description, (SELECT title FROM channels WHERE id = new.channel_id));
    END;
  `);
  db.exec(trigger === 'old' ? LEGACY_VIDEOS_AU : FTS_UPDATE_TRIGGERS.videos_au);
  const insertChannel = db.prepare('INSERT INTO channels (id, title) VALUES (?, ?)');
  const insertVideo = db.prepare("INSERT INTO videos (id, title, description, channel_id, download_status, created_at) VALUES (?, ?, ?, ?, 'downloading', ?)");
  db.transaction(() => {
    for (let c = 0; c < 50; c++) insertChannel.run(`c${c}`, `Channel number ${c}`);
    for (let i = 0; i < VIDEO_COUNT; i++) insertVideo.run(`v${i}`, `Synthetic video ${i} about topic ${i % 97}`, `${i} ${DESCRIPTION}`, `c${i % 50}`, Date.now());
  })();
  db.pragma('wal_checkpoint(TRUNCATE)');
  return db;
}

function measureUpdateCost(db) {
  const stmt = db.prepare('UPDATE videos SET download_progress = ?, download_speed = ?, download_eta = ? WHERE id = ?');
  for (let i = 0; i < 200; i++) stmt.run(i % 100, '1.0MiB/s', '00:10', `v${i}`); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < UPDATES; i++) stmt.run(i % 100, `${(i % 50) / 10}MiB/s`, '00:10', `v${(i * 7919) % VIDEO_COUNT}`);
  return ((performance.now() - t0) * 1000) / UPDATES; // microseconds per update
}

/**
 * `writers` downloads each emitting `linesPerSecond` progress lines for
 * STORM_SECONDS, like concurrent yt-dlp processes. "old" prepares and runs one
 * UPDATE per line (the previous handler); "new" goes through the real
 * createDbProgressWriter (prepared once, at most one write per second, only on change).
 */
async function storm(rawDb, mode, { writers, linesPerSecond }) {
  // Times every prepare() and run() made through this handle (the database work on the event loop).
  let dbWrites = 0;
  let dbMs = 0;
  const db = {
    prepare(sql) {
      const t0 = performance.now();
      const statement = rawDb.prepare(sql);
      dbMs += performance.now() - t0;
      return {
        run(...args) {
          const t1 = performance.now();
          const result = statement.run(...args);
          dbMs += performance.now() - t1;
          dbWrites++;
          return result;
        },
      };
    },
  };
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  const sinks = [];
  for (let w = 0; w < writers; w++) {
    const id = `v${w}`;
    if (mode === 'old') {
      // The previous handler: prepare and run one UPDATE for every progress line.
      sinks.push((progress, speed, eta) => {
        db.prepare('UPDATE videos SET download_progress = ?, download_speed = ?, download_eta = ? WHERE id = ?').run(progress, speed, eta, id);
      });
    } else {
      const writer = createDbProgressWriter(db, 'videos', id);
      const sink = (progress, speed, eta) => writer.update({ progress, speed, eta });
      sink.writer = writer;
      sinks.push(sink);
    }
  }

  histogram.enable();
  const timers = [];
  let line = 0;
  const started = performance.now();
  await new Promise((resolve) => {
    for (let w = 0; w < writers; w++) {
      const sink = sinks[w];
      timers.push(setInterval(() => {
        line++;
        const elapsed = (performance.now() - started) / 1000;
        const progress = Math.min(100, Math.round((elapsed / STORM_SECONDS) * 100));
        sink(progress, `${(1 + ((line * 13) % 40) / 10).toFixed(1)}MiB/s`, `00:${String(59 - (Math.floor(elapsed) % 60)).padStart(2, '0')}`);
      }, 1000 / linesPerSecond));
    }
    setTimeout(resolve, STORM_SECONDS * 1000);
  });
  for (const t of timers) clearInterval(t);
  for (const s of sinks) s.writer?.stop();
  histogram.disable();
  return {
    lines: line,
    dbWrites,
    dbMs,
    maxMs: histogram.max / 1e6,
    p99Ms: histogram.percentile(99) / 1e6,
    meanMs: histogram.mean / 1e6,
  };
}

const fmt = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '-');
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

console.log(`Synthetic library: ${VIDEO_COUNT} videos, ${DESCRIPTION.length}-byte descriptions, temp dir ${tmpRoot}\n`);

const configs = [
  { name: 'old trigger, synchronous=FULL (before)', trigger: 'old', tuned: false },
  { name: 'old trigger, synchronous=NORMAL', trigger: 'old', tuned: true },
  { name: 'new trigger, synchronous=FULL', trigger: 'new', tuned: false },
  { name: 'new trigger, synchronous=NORMAL (after)', trigger: 'new', tuned: true },
];
console.log(`(a) Cost of one progress UPDATE (autocommit), mean of ${UPDATES}`);
console.log(`${pad('configuration', 42)}${lpad('us/update', 12)}`);
const dbs = {};
for (const c of configs) {
  const db = buildDb(c.name.replace(/\W+/g, '_'), c);
  dbs[`${c.trigger}-${c.tuned}`] = db;
  console.log(`${pad(c.name, 42)}${lpad(fmt(measureUpdateCost(db), 1), 12)}`);
}

console.log(`\n(b) Event-loop lag during a progress storm (${STORM_SECONDS} s each, monitorEventLoopDelay)`);
console.log('(lag columns include the 10 ms histogram resolution; "db ms" = time the event loop spent in SQLite)');
console.log(`${pad('storm', 20)}${pad('behaviour', 34)}${lpad('lines', 7)}${lpad('db writes', 11)}${lpad('db ms', 9)}${lpad('max ms', 9)}${lpad('p99 ms', 9)}${lpad('mean ms', 9)}`);
for (const load of [{ writers: 8, linesPerSecond: 10 }, { writers: 8, linesPerSecond: 100 }]) {
  const label = `${load.writers} x ${load.linesPerSecond} lines/s`;
  const old = await storm(dbs['old-false'], 'old', load);
  console.log(`${pad(label, 20)}${pad('old (per line, old trigger, FULL)', 34)}${lpad(old.lines, 7)}${lpad(old.dbWrites, 11)}${lpad(fmt(old.dbMs), 9)}${lpad(fmt(old.maxMs), 9)}${lpad(fmt(old.p99Ms), 9)}${lpad(fmt(old.meanMs), 9)}`);
  const neu = await storm(dbs['new-true'], 'new', load);
  console.log(`${pad(label, 20)}${pad('new (throttled writer, NORMAL)', 34)}${lpad(neu.lines, 7)}${lpad(neu.dbWrites, 11)}${lpad(fmt(neu.dbMs), 9)}${lpad(fmt(neu.maxMs), 9)}${lpad(fmt(neu.p99Ms), 9)}${lpad(fmt(neu.meanMs), 9)}`);
}
for (const db of Object.values(dbs)) db.close();
console.log('\nNote: on a fast SSD fsync is cheap, so the lag gap is small here; on a busy spinning disk each');
console.log('commit of the old path waits for an fsync while blocking the event loop.');
