import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import handler from '../../server/routes/downloads-music/[...path]';
import { createTestDb, insertMusicArtist, insertMusicTrack, mockEvent } from '../helpers/testDb';
import { getMusicDownloadsDir } from '../../server/utils/musicDownloader';
import { sanitizeFolderName } from '../../server/utils/downloader';
import { canAccessMusicTrack } from '../../server/utils/auth';

let db: Database.Database;
const artistId = 'cache-control-test-artist';
let artistDir: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).getMusicDownloadsDir = getMusicDownloadsDir;
  (globalThis as any).sanitizeFolderName = sanitizeFolderName;
  (globalThis as any).canAccessMusicTrack = canAccessMusicTrack;
  insertMusicArtist(db, { id: artistId, name: `Artist ${artistId}`, visibility: 'public' });
  artistDir = path.join(getMusicDownloadsDir(), sanitizeFolderName(`Artist ${artistId}`));
  fs.mkdirSync(artistDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(artistDir, { recursive: true, force: true });
});

function writeFile(trackId: string, ext: string, mtime?: Date) {
  const filePath = path.join(artistDir, `${trackId}.${ext}`);
  fs.writeFileSync(filePath, 'x');
  if (mtime) fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function eventFor(trackId: string, ext: string, headers?: Record<string, string>) {
  return mockEvent(undefined, { path: `/downloads-music/${artistId}/${trackId}.${ext}`, params: { path: `${artistId}/${trackId}.${ext}` }, headers });
}

describe('GET /downloads-music/[...path] — Cache-Control', () => {
  it('sets an immutable long-lived Cache-Control on an audio file, with no Last-Modified', async () => {
    insertMusicTrack(db, { id: 't1', artistId, downloadStatus: 'completed' });
    writeFile('t1', 'opus');
    const event = eventFor('t1', 'opus');

    await handler(event);

    expect(event.node.res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(event.node.res.headers['last-modified']).toBeUndefined();
  });

  it('sets an immutable Cache-Control on a clip (.mp4) file too', async () => {
    insertMusicTrack(db, { id: 't2', artistId, downloadStatus: 'completed', hasClip: true });
    writeFile('t2', 'mp4');
    const event = eventFor('t2', 'mp4');

    await handler(event);

    expect(event.node.res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
  });

  it('sets a must-revalidate Cache-Control and Last-Modified on a cover image', async () => {
    insertMusicTrack(db, { id: 't3', artistId, downloadStatus: 'completed' });
    writeFile('t3', 'jpg');
    const event = eventFor('t3', 'jpg');

    await handler(event);

    expect(event.node.res.headers['cache-control']).toBe('private, must-revalidate');
    expect(event.node.res.headers['last-modified']).toBeDefined();
  });

  it('returns 304 with no body when If-Modified-Since is at or after the file mtime', async () => {
    insertMusicTrack(db, { id: 't4', artistId, downloadStatus: 'completed' });
    const mtime = new Date('2026-01-01T00:00:00Z');
    writeFile('t4', 'jpg', mtime);
    const event = eventFor('t4', 'jpg', { 'if-modified-since': new Date('2026-01-01T00:00:00Z').toUTCString() });

    const result = await handler(event);

    expect(event.node.res.statusCode).toBe(304);
    expect(result).toBeFalsy();
  });

  it('returns 200 with content when If-Modified-Since predates the file mtime', async () => {
    insertMusicTrack(db, { id: 't5', artistId, downloadStatus: 'completed' });
    const mtime = new Date('2026-01-01T00:00:00Z');
    writeFile('t5', 'jpg', mtime);
    const event = eventFor('t5', 'jpg', { 'if-modified-since': new Date('2025-01-01T00:00:00Z').toUTCString() });

    const result = await handler(event);

    expect(event.node.res.statusCode).toBe(200);
    expect(result).toBeTruthy();
  });

  it('still returns 403 for a private artist without access (regression)', async () => {
    const privateArtistId = 'cache-control-private-artist';
    insertMusicArtist(db, { id: privateArtistId, name: `Artist ${privateArtistId}`, visibility: 'private' });
    const privateDir = path.join(getMusicDownloadsDir(), sanitizeFolderName(`Artist ${privateArtistId}`));
    fs.mkdirSync(privateDir, { recursive: true });
    fs.writeFileSync(path.join(privateDir, 't6.opus'), 'x');
    insertMusicTrack(db, { id: 't6', artistId: privateArtistId, downloadStatus: 'completed' });

    try {
      await expect(handler(mockEvent(undefined, { path: `/downloads-music/${privateArtistId}/t6.opus`, params: { path: `${privateArtistId}/t6.opus` } }))).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      fs.rmSync(privateDir, { recursive: true, force: true });
    }
  });

  it('still returns 404 for a missing file (regression)', async () => {
    insertMusicTrack(db, { id: 't7', artistId, downloadStatus: 'completed' });
    await expect(handler(eventFor('t7', 'opus'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('still supports Range requests with 206 on audio (regression)', async () => {
    insertMusicTrack(db, { id: 't8', artistId, downloadStatus: 'completed' });
    writeFile('t8', 'opus');
    const event = eventFor('t8', 'opus', { range: 'bytes=0-0' });

    await handler(event);

    expect(event.node.res.statusCode).toBe(206);
    expect(event.node.res.headers['content-range']).toBe('bytes 0-0/1');
  });
});
