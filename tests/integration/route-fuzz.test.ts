import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { assertInTmp, mockEvent, sessionCookie } from '../helpers/testDb';

// Safety net for every API route: a battery of malformed inputs (bodies that
// are not objects, fields of the wrong type, odd query values and ids) must
// never produce a 500. Child processes and outbound requests are replaced by
// fakes that fail, so an upstream failure must be reported as a 502.

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {} };
  child.pid = undefined;
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  setImmediate(() => {
    child.emit('error', new Error('spawn disabled in tests'));
    child.emit('close', 1, null);
  });
  return child;
}
vi.mock('child_process', async (importOriginal) => {
  const real: any = await importOriginal();
  const mocked = {
    ...real,
    spawn: () => fakeChild(),
    execFile: (...args: any[]) => { const cb = args.find((a) => typeof a === 'function'); setImmediate(() => cb?.(new Error('spawn disabled in tests'), '', '')); return fakeChild(); },
    exec: (...args: any[]) => { const cb = args.find((a) => typeof a === 'function'); setImmediate(() => cb?.(new Error('spawn disabled in tests'), '', '')); return fakeChild(); },
    spawnSync: () => ({ status: 1, stdout: '', stderr: 'spawn disabled in tests', error: new Error('spawn disabled in tests') }),
    execSync: () => { throw new Error('spawn disabled in tests'); },
    execFileSync: () => { throw new Error('spawn disabled in tests'); },
  };
  return { ...mocked, default: mocked };
});

// No real HTTP either: Node's http/https clients fail at once.
function failingRequest(...args: any[]) {
  const req: any = new EventEmitter();
  req.end = () => {};
  req.write = () => {};
  req.destroy = () => {};
  req.setTimeout = () => req;
  setImmediate(() => req.emit('error', new Error('network disabled in tests')));
  void args;
  return req;
}
vi.mock('https', async (importOriginal) => {
  const real: any = await importOriginal();
  const mocked = { ...real, get: failingRequest, request: failingRequest };
  return { ...mocked, default: mocked };
});
vi.mock('http', async (importOriginal) => {
  const real: any = await importOriginal();
  const mocked = { ...real, get: failingRequest, request: failingRequest };
  return { ...mocked, default: mocked };
});

const ROOT = path.resolve(__dirname, '../..');
const API = path.join(ROOT, 'server/api');

// Routes that wipe or rewrite the whole library on disk: covered by their own tests.
const SKIP = new Set([
  'admin/system/wipe-all.post.ts',
  'admin/library/tidy/start.post.ts',
]);

const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;

function freshDb() {
  try { db?.close(); } catch {}
  db = openDatabase(path.join(dir, `fuzz-${Math.random().toString(36).slice(2)}.db`));
  const now = Date.now();
  for (const [id, role] of [['admin', 'admin'], ['bob', 'user']]) {
    db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, id, '$2b$10$073K657YTnd.q68kw787sOXGW10kBnYDukAbbfnoGX.i8R06CQj92', role, now);
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(`sess-${id}`, id, now + 3_600_000);
  }
  db.prepare("INSERT INTO channels (id, title, created_at) VALUES ('UCaaaaaaaaaaaaaaaaaaaaaa', 'Chan', ?)").run(now);
  db.prepare("INSERT INTO videos (id, title, channel_id, download_status, created_at) VALUES ('aaaaaaaaaaa', 'V', 'UCaaaaaaaaaaaaaaaaaaaaaa', 'completed', ?)").run(now);
  db.prepare("INSERT INTO music_artists (id, name, created_at) VALUES ('art1', 'A', ?)").run(now);
  db.prepare("INSERT INTO music_albums (id, artist_id, title, source, created_at) VALUES ('alb1', 'art1', 'Al', 'manual', ?)").run(now);
  db.prepare("INSERT INTO music_tracks (id, artist_id, album_id, title, download_status, created_at) VALUES ('bbbbbbbbbbb', 'art1', 'alb1', 'T', 'completed', ?)").run(now);
  db.prepare("INSERT INTO podcast_shows (id, feed_url, title, created_at) VALUES ('show1', 'https://example.invalid/f', 'S', ?)").run(now);
  db.prepare("INSERT INTO podcast_episodes (id, show_id, title, audio_url, download_status, created_at) VALUES ('ep1', 'show1', 'E', 'https://example.invalid/a.mp3', 'completed', ?)").run(now);
  db.prepare("INSERT INTO personal_playlists (id, title, user_id, visibility, created_at) VALUES ('pl1', 'P', 'admin', 'private', ?)").run(now);
  db.prepare("INSERT INTO music_user_playlists (id, user_id, title, created_at, updated_at) VALUES ('mpl1', 'admin', 'M', ?, ?)").run(now, now);
}

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-fuzz-'));
  assertInTmp(dir);
  process.env.YOUKEEP_DATA_DIR = dir;
  // A yt-dlp binary is "installed", so nothing tries to download one.
  const { getDataDir } = await import('../../server/utils/dataDir');
  const bin = path.join(getDataDir(), 'bin');
  assertInTmp(bin);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'), 'fake');
  freshDb();
  (globalThis as any).getDb = () => db;
  vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
  // Nuxt auto-imports, as the server provides them.
  const h3 = await import('h3');
  for (const [k, v] of Object.entries(h3)) if (!(k in globalThis)) (globalThis as any)[k] = v;
  for (const file of fs.readdirSync(path.join(ROOT, 'server/utils')).filter((f) => f.endsWith('.ts') && f !== 'db.ts')) {
    const mod = await import(path.join(ROOT, 'server/utils', file));
    for (const [k, v] of Object.entries(mod)) if (!(k in globalThis)) (globalThis as any)[k] = v;
  }
  // Background queue workers are not part of a route's answer.
  for (const name of ['startQueueWorker', 'startMusicQueueWorker', 'startPodcastQueueWorker']) {
    (globalThis as any)[name] = async () => {};
  }
});
afterAll(() => {
  try { db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function listRoutes(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(path.relative(API, p));
    }
  };
  walk(API);
  return out.sort();
}

const WRONG_VALUES: unknown[] = [null, 123, -1, 1e309, true, [], ['a', 'b'], { a: 1 }, '', 'x'.repeat(5000), '\u0000'];
const BAD_BODIES: unknown[] = [undefined, null, [], 'x', 123, true, {}];
const BAD_QUERY_VALUES = ['', 'abc', '-1', '0', '1e309', '1.5', '%00', 'x'.repeat(3000)];
const BAD_IDS = ['nope', '../../etc/passwd', 'x'.repeat(3000), '%00'];

function fieldsOf(source: string, pattern: RegExp): string[] {
  return [...new Set([...source.matchAll(pattern)].map((m) => m[1]!))];
}

function bodyFields(source: string): string[] {
  const direct = fieldsOf(source, /\bbody\??\.(\w+)/g);
  const destructured = [...source.matchAll(/const\s*\{([^}]+)\}\s*=\s*(?:body|await readBody\(event\))/g)]
    .flatMap((m) => m[1]!.split(',').map((s) => s.split(':')[0]!.split('=')[0]!.trim()).filter(Boolean));
  const keyed = fieldsOf(source, /\(body,\s*'(\w+)'/g);
  return [...new Set([...direct, ...destructured, ...keyed])].filter((f) => !['length'].includes(f));
}

function idFor(name: string, rel: string): string {
  if (name === 'trackId') return 'bbbbbbbbbbb';
  if (name === 'episodeId') return 'ep1';
  if (rel.startsWith('admin/channels') || rel.startsWith('channels')) return 'UCaaaaaaaaaaaaaaaaaaaaaa';
  if (rel.includes('videos')) return 'aaaaaaaaaaa';
  if (rel.includes('music/albums')) return 'alb1';
  if (rel.includes('music/artists')) return 'art1';
  if (rel.includes('music/tracks')) return 'bbbbbbbbbbb';
  if (rel.includes('user-playlists')) return 'mpl1';
  if (rel.includes('playlists')) return 'pl1';
  if (rel.includes('podcasts/shows')) return 'show1';
  if (rel.includes('podcasts/episodes')) return 'ep1';
  if (rel.includes('users')) return 'bob';
  if (rel.includes('tokens')) return 'tok1';
  return 'x';
}

async function call(handler: any, event: any): Promise<{ status: number; message: string }> {
  try {
    await handler(event);
    return { status: event.node.res.statusCode ?? 200, message: '' };
  } catch (e: any) {
    return { status: e?.statusCode ?? 500, message: String(e?.statusMessage ?? e?.message ?? '') };
  }
}

const routes = listRoutes().filter((r) => !SKIP.has(r));

describe('every API route survives malformed input', () => {
  it('found the routes', () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  for (const rel of routes) {
    it(rel, async () => {
      freshDb();
      const source = fs.readFileSync(path.join(API, rel), 'utf8');
      const method = (rel.match(/\.(get|post|put|patch|delete)\.ts$/)?.[1] ?? 'get').toUpperCase();
      const paramNames = [...rel.matchAll(/\[(\w+)\]/g)].map((m) => m[1]!);
      const goodParams = Object.fromEntries(paramNames.map((n) => [n, idFor(n, rel)]));
      const url = '/api/' + rel.replace(/\.(get|post|put|patch|delete)\.ts$|\.ts$/, '').replace(/\/index$/, '');
      const handler = (await import(path.join(API, rel))).default;
      const failures: string[] = [];
      const check = async (label: string, cookie: string | undefined, opts: any) => {
        const event = mockEvent(cookie, { method, path: opts.path ?? url, params: opts.params ?? goodParams, ...('body' in opts ? { body: opts.body } : { body: undefined }) });
        const { status, message } = await call(handler, event);
        if ((status >= 500 && status !== 502 && status !== 503) || /TypeError|RangeError|SqliteError|CronPattern|at \//.test(message)) {
          failures.push(`${label} -> ${status} ${message.slice(0, 160)}`);
        }
      };

      const admin = sessionCookie('sess-admin');
      const fields = bodyFields(source);
      const queryKeys = fieldsOf(source, /\bquery\??\.(\w+)/g);

      if (method !== 'GET' && method !== 'DELETE' || fields.length > 0) {
        for (const body of BAD_BODIES) await check(`body ${JSON.stringify(body)}`, admin, { body });
        for (const field of fields) {
          for (const value of WRONG_VALUES) await check(`${field}=${JSON.stringify(value)?.slice(0, 40)}`, admin, { body: { [field]: value } });
        }
      }
      for (const key of [...new Set([...queryKeys, 'limit', 'offset', 'page'])]) {
        for (const value of BAD_QUERY_VALUES) {
          await check(`?${key}=${value.slice(0, 20)}`, admin, { path: `${url}?${key}=${encodeURIComponent(value)}` });
        }
        await check(`?${key} twice`, admin, { path: `${url}?${key}=a&${key}=b` });
      }
      for (const name of paramNames) {
        for (const bad of BAD_IDS) await check(`:${name}=${bad.slice(0, 20)}`, admin, { params: { ...goodParams, [name]: bad } });
      }
      await check('guest', undefined, {});
      await check('member', sessionCookie('sess-bob'), {});

      expect(failures).toEqual([]);
    }, 60_000);
  }
});
