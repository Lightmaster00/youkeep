import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import handler from '../../server/routes/downloads/[...path]';
import { createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';
import { getDownloadsDir, sanitizeFolderName } from '../../server/utils/downloader';
import { canAccessVideo } from '../../server/utils/auth';

let db: Database.Database;
const channelId = 'cache-control-test-channel';
let channelDir: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).getDownloadsDir = getDownloadsDir;
  (globalThis as any).sanitizeFolderName = sanitizeFolderName;
  (globalThis as any).canAccessVideo = canAccessVideo;
  (globalThis as any).getQuery = () => ({});
  insertChannel(db, { id: channelId, visibility: 'public' });
  channelDir = path.join(getDownloadsDir(), sanitizeFolderName(`Channel ${channelId}`));
  fs.mkdirSync(channelDir, { recursive: true });
});

afterEach(async () => {
  // fs.createReadStream() opens the underlying fd lazily on the next tick —
  // if a test's returned stream is never consumed, that open can still be
  // pending when this cleanup deletes the fixture file, producing a spurious
  // unhandled ENOENT. Destroy any stream the test captured and yield one
  // tick before removing the directory so any already-pending open settles
  // (harmlessly, since nothing is listening) rather than firing later.
  await new Promise((resolve) => setImmediate(resolve));
  fs.rmSync(channelDir, { recursive: true, force: true });
});

function closeIfStream(result: any) {
  if (result && typeof result.destroy === 'function') {
    result.on?.('error', () => {});
    result.destroy();
  }
}

function writeFile(videoId: string, ext: string, mtime?: Date) {
  const filePath = path.join(channelDir, `${videoId}.${ext}`);
  fs.writeFileSync(filePath, 'x');
  if (mtime) fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function eventFor(videoId: string, ext: string, headers?: Record<string, string>) {
  return mockEvent(undefined, { path: `/downloads/${channelId}/${videoId}.${ext}`, params: { path: `${channelId}/${videoId}.${ext}` }, headers });
}

describe('GET /downloads/[...path] — Cache-Control', () => {
  it('sets an immutable long-lived Cache-Control on a video file, with no Last-Modified', async () => {
    insertVideo(db, { id: 'v1', channelId, downloadStatus: 'completed' });
    writeFile('v1', 'mp4');
    const event = eventFor('v1', 'mp4');

    closeIfStream(await handler(event));

    expect(event.node.res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(event.node.res.headers['last-modified']).toBeUndefined();
  });

  it('sets a must-revalidate Cache-Control and Last-Modified on a thumbnail', async () => {
    insertVideo(db, { id: 'v2', channelId, downloadStatus: 'completed' });
    writeFile('v2', 'jpg');
    const event = eventFor('v2', 'jpg');

    closeIfStream(await handler(event));

    expect(event.node.res.headers['cache-control']).toBe('private, must-revalidate');
    expect(event.node.res.headers['last-modified']).toBeDefined();
  });

  it('returns 304 with no body when If-Modified-Since is at or after the file mtime', async () => {
    insertVideo(db, { id: 'v3', channelId, downloadStatus: 'completed' });
    const mtime = new Date('2026-01-01T00:00:00Z');
    writeFile('v3', 'jpg', mtime);
    const event = eventFor('v3', 'jpg', { 'if-modified-since': new Date('2026-01-01T00:00:00Z').toUTCString() });

    const result = await handler(event);

    expect(event.node.res.statusCode).toBe(304);
    expect(result).toBeFalsy();
  });

  it('returns 200 with content when If-Modified-Since predates the file mtime', async () => {
    insertVideo(db, { id: 'v4', channelId, downloadStatus: 'completed' });
    const mtime = new Date('2026-01-01T00:00:00Z');
    writeFile('v4', 'jpg', mtime);
    const event = eventFor('v4', 'jpg', { 'if-modified-since': new Date('2025-01-01T00:00:00Z').toUTCString() });

    const result = await handler(event);
    closeIfStream(result);

    expect(event.node.res.statusCode).toBe(200);
    expect(result).toBeTruthy();
  });

  it('still returns 403 for a private channel without access (regression)', async () => {
    const privateChannelId = 'cache-control-private-channel';
    insertChannel(db, { id: privateChannelId, visibility: 'private' });
    const privateDir = path.join(getDownloadsDir(), sanitizeFolderName(`Channel ${privateChannelId}`));
    fs.mkdirSync(privateDir, { recursive: true });
    fs.writeFileSync(path.join(privateDir, 'v5.mp4'), 'x');
    insertVideo(db, { id: 'v5', channelId: privateChannelId, visibility: 'private', downloadStatus: 'completed' });

    try {
      await expect(handler(mockEvent(undefined, { path: `/downloads/${privateChannelId}/v5.mp4`, params: { path: `${privateChannelId}/v5.mp4` } }))).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      fs.rmSync(privateDir, { recursive: true, force: true });
    }
  });

  it('still returns 404 for a missing file (regression)', async () => {
    insertVideo(db, { id: 'v6', channelId, downloadStatus: 'completed' });
    await expect(handler(eventFor('v6', 'mp4'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('still supports Range requests with 206 (regression)', async () => {
    insertVideo(db, { id: 'v7', channelId, downloadStatus: 'completed' });
    writeFile('v7', 'mp4');
    const event = eventFor('v7', 'mp4', { range: 'bytes=0-0' });

    closeIfStream(await handler(event));

    expect(event.node.res.statusCode).toBe(206);
    expect(event.node.res.headers['content-range']).toBe('bytes 0-0/1');
  });
});
