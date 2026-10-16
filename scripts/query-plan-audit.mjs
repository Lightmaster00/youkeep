#!/usr/bin/env node
// Dev audit (not part of the app build): builds a synthetic big library in a
// temporary folder with the real schema (100k videos, 90k tracks, 90k episodes,
// 300k plays, 1000 artists; see tests/helpers/bigLibrary.ts), calls every read
// route as a guest, two users and an admin, and reports:
//   - each route's wall time;
//   - every SQL statement slower than the threshold, with its EXPLAIN QUERY PLAN;
//   - every statement whose plan contains a correlated subquery or scans a big table.
// Usage: node scripts/query-plan-audit.mjs [--small] [--threshold-ms 50] [--only <path substring>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const SMALL = process.argv.includes('--small');
const THRESHOLD_MS = Number(arg('--threshold-ms') ?? 50);
const ONLY = arg('--only');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-plan-audit-'));
process.env.YOUKEEP_DATA_DIR = tmpRoot;
process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

const origLog = console.log;
console.log = () => {};
const { openDatabase } = await jiti.import(path.join(ROOT, 'server/utils/db.ts'));
const { seedBigLibrary, AUDIT_SIZES, REGRESSION_SIZES } = await jiti.import(path.join(ROOT, 'tests/helpers/bigLibrary.ts'));
const { mockEvent, sessionCookie } = await jiti.import(path.join(ROOT, 'tests/helpers/testDb.ts'));
const db = openDatabase(path.join(tmpRoot, 'youkeep.db'));
console.log = origLog;

let t0 = performance.now();
seedBigLibrary(db, SMALL ? REGRESSION_SIZES : AUDIT_SIZES);
console.log(`Seeded ${SMALL ? 'regression' : 'audit'} library in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// Statement timing: every prepared statement reports its run time and arguments.
const slow = new Map();
const realPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const stmt = realPrepare(sql);
  return new Proxy(stmt, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function' || !['all', 'get', 'run'].includes(prop)) return typeof value === 'function' ? value.bind(target) : value;
      return (...args) => {
        const start = performance.now();
        try { return value.apply(target, args); } finally {
          const ms = performance.now() - start;
          const key = sql.replace(/\s+/g, ' ').trim();
          const prev = slow.get(key);
          if (!prev || prev.ms < ms) slow.set(key, { ms, args, sql });
        }
      };
    },
  });
};

// Nuxt auto-imports, as the server provides them.
globalThis.getDb = () => db;
const h3 = await import('h3');
for (const [k, v] of Object.entries(h3)) if (!(k in globalThis)) globalThis[k] = v;
for (const file of fs.readdirSync(path.join(ROOT, 'server/utils')).filter((f) => f.endsWith('.ts') && f !== 'db.ts')) {
  const mod = await jiti.import(path.join(ROOT, 'server/utils', file));
  for (const [k, v] of Object.entries(mod)) if (!(k in globalThis)) globalThis[k] = v;
}

const PARAMS = { id: null, name: 'Rock' };
const ID_FOR = (route) => {
  if (route.includes('/channels/')) return 'c0';
  if (route.includes('/music/albums/')) return 'al0_0';
  if (route.includes('/music/artists/')) return 'a0';
  if (route.includes('/podcasts/shows/')) return 's0';
  if (route.includes('/videos/')) return 'v1';
  if (route.includes('/user-playlists/')) return 'none';
  if (route.includes('/playlists/')) return 'none';
  return 'x';
};
const QUERY_FOR = (route) => {
  if (route.endsWith('search.get.ts')) return '?q=track';
  if (route.includes('artist-mix')) return '?artistId=a0';
  if (route.includes('genre-mix')) return '?genre=Rock';
  if (route.includes('radio')) return '?trackId=t1';
  return '';
};

const routes = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.get.ts') && !p.includes('/admin/') && !p.includes('/auth/') && !p.includes('/account/')) routes.push(p);
  }
};
walk(path.join(ROOT, 'server/api'));
routes.sort();

const sessions = { guest: undefined, light: sessionCookie('sess-light'), heavy: sessionCookie('sess-heavy'), admin: sessionCookie('sess-admin') };
const timings = [];
for (const file of routes) {
  const rel = path.relative(path.join(ROOT, 'server'), file);
  if (ONLY && !rel.includes(ONLY)) continue;
  const handler = (await jiti.import(file)).default;
  for (const [who, cookie] of Object.entries(sessions)) {
    const route = rel.replace(/^api/, '/api').replace(/\.get\.ts$/, '').replace(/\/index$/, '');
    const event = mockEvent(cookie, { path: route + QUERY_FOR(rel), params: { ...PARAMS, id: ID_FOR(rel) } });
    const start = performance.now();
    let status = 200;
    try { await handler(event); } catch (e) { status = e?.statusCode ?? 500; if (status === 500) console.log(`  ${rel} as ${who}: ${e?.message}`); }
    timings.push({ rel, who, ms: performance.now() - start, status });
  }
}

console.log('\nRoute timings (worst role):');
const worst = new Map();
for (const t of timings) if (!worst.has(t.rel) || worst.get(t.rel).ms < t.ms) worst.set(t.rel, t);
for (const t of [...worst.values()].sort((a, b) => b.ms - a.ms)) console.log(`  ${t.ms.toFixed(1).padStart(9)} ms  ${t.rel} (${t.who}, ${t.status})`);

const BIG = /SCAN (videos|music_tracks|podcast_episodes|music_play_history|user_history|music_favorites|podcast_episode_progress)\b(?! USING)/;
console.log(`\nStatements slower than ${THRESHOLD_MS} ms or with a suspicious plan:`);
for (const [key, { ms, args, sql }] of [...slow].sort((a, b) => b[1].ms - a[1].ms)) {
  let plan = [];
  try { plan = realPrepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail); } catch { continue; }
  const suspicious = plan.some((d) => d.includes('CORRELATED') || BIG.test(d));
  if (ms < THRESHOLD_MS && !(suspicious && ms >= THRESHOLD_MS / 10)) continue;
  console.log(`\n--- ${ms.toFixed(1)} ms${suspicious ? ' [suspicious plan]' : ''}\n${key.slice(0, 400)}`);
  for (const d of plan) console.log(`    ${d}`);
}
db.close();
