import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import * as auth from '../../server/utils/auth';
import { assertInTmp, mockEvent, sessionCookie } from '../helpers/testDb';
import videoGet from '../../server/api/videos/[id].get';
import videosIndex from '../../server/api/videos/index.get';
import recommendGet from '../../server/api/videos/recommend.get';
import channelGet from '../../server/api/channels/[id].get';
import channelsIndex from '../../server/api/channels/index.get';
import channelPlaylists from '../../server/api/channels/[id]/playlists.get';
import playlistGet from '../../server/api/playlists/[id].get';
import personalGet from '../../server/api/playlists/personal/[id].get';
import personalIndex from '../../server/api/playlists/personal/index.get';
import personalVideosPost from '../../server/api/playlists/personal/[id]/videos.post';
import albumGet from '../../server/api/music/albums/[id].get';
import artistGet from '../../server/api/music/artists/[id]/index.get';
import artistOverview from '../../server/api/music/artists/[id]/overview.get';
import artistSongs from '../../server/api/music/artists/[id]/songs.get';
import artistTracks from '../../server/api/music/artists/[id]/tracks.get';
import showGet from '../../server/api/podcasts/shows/[id]/index.get';
import showEpisodes from '../../server/api/podcasts/shows/[id]/episodes.get';
import trackPlay from '../../server/api/music/tracks/[id]/play.post';
import channelSubscribe from '../../server/api/channels/[id]/subscribe.post';
import personalDelete from '../../server/api/playlists/personal/[id].delete';

// What a viewer can learn from the API about content they may not see.
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;
const ADMIN = sessionCookie('sess-admin');
const BOB = sessionCookie('sess-bob');
const CAROL = sessionCookie('sess-carol');

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-exposure-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
  Object.assign(globalThis as any, auth);
  const now = Date.now();
  for (const [id, role] of [['admin', 'admin'], ['bob', 'user'], ['carol', 'user']]) {
    db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, id, 'x', role, now);
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(`sess-${id}`, id, now + 3_600_000);
  }
  const channel = db.prepare(`INSERT INTO channels (id, title, visibility, custom_save_path, import_error, date_after, created_at)
    VALUES (?, ?, ?, '/srv/secret/path', 'boom at /srv', '20200101', ?)`);
  channel.run('chP', 'Public Channel', 'public', now);
  channel.run('chV', 'Private Channel', 'private', now);
  channel.run('chU', 'Ultra Channel', 'ultra_private', now);
  const video = db.prepare(`INSERT INTO videos (id, title, channel_id, visibility, download_status, share_token, last_error,
    retry_count, priority, is_manually_queued, size_bytes, duration, view_count, is_short, local_video_path, local_thumbnail_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'yt-dlp stderr /srv/x', 2, 5, 1, 1000, 100, 10, ?, ?, ?, ?)`);
  video.run('vP', 'Public video', 'chP', 'public', 'completed', 'tokP', 0, '/media/vP.mp4', '/media/vP.jpg', now - 1);
  video.run('vPH', 'Private in public', 'chP', 'private', 'completed', 'tokPH', 0, '/media/vPH.mp4', '/media/vPH.jpg', now - 2);
  video.run('vPU', 'Ultra in public', 'chP', 'ultra_private', 'completed', 'tokPU', 0, '/media/hidden-title.mp4', '/media/hidden-title.jpg', now - 3);
  video.run('vPend', 'Pending', 'chP', 'public', 'pending', null, 0, null, null, now - 4);
  video.run('vV', 'In private channel', 'chV', 'public', 'completed', 'tokV', 0, '/media/vV.mp4', '/media/vV.jpg', now - 5);
  video.run('vU', 'In ultra channel', 'chU', 'public', 'completed', 'tokU', 0, '/media/vU.mp4', '/media/vU.jpg', now - 6);
  video.run('sU', 'Ultra short', 'chU', 'public', 'completed', null, 1, '/media/sU.mp4', '/media/sU.jpg', now - 7);
  db.prepare("INSERT INTO comments (id, video_id, author, text, created_at) VALUES ('cm1', 'vP', 'A', 'hi', 0)").run();
  db.prepare("INSERT INTO playlists (id, title, channel_id, created_at) VALUES ('plP', 'Mixed', 'chP', 0)").run();
  for (const [i, v] of ['vP', 'vPH', 'vPU'].entries()) {
    db.prepare("INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES ('plP', ?, ?)").run(v, i);
  }
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const ev = (cookie: string | undefined, url: string, params: Record<string, string> = {}, body?: any) =>
  mockEvent(cookie, { path: url, params, ...(body !== undefined ? { body, method: 'POST' } : {}) });
const status = async (p: Promise<any>) => { try { await p; return 200; } catch (e: any) { return e?.statusCode ?? 500; } };

function personalPlaylist(id: string, owner: string, visibility = 'private', videos: string[] = []) {
  db.prepare("INSERT INTO personal_playlists (id, title, user_id, visibility, share_token, created_at) VALUES (?, ?, ?, ?, ?, 0)")
    .run(id, `PL ${id}`, owner, visibility, `share-${id}`);
  videos.forEach((v, i) => db.prepare('INSERT INTO personal_playlist_videos (playlist_id, video_id, position) VALUES (?, ?, ?)').run(id, v, i));
}

describe('personal playlists (H1)', () => {
  it('adding a video the user cannot see answers 404 like a missing one', async () => {
    personalPlaylist('pb', 'bob');
    expect(await status(personalVideosPost(ev(BOB, '/x', { id: 'pb' }, { action: 'add', videoId: 'vU' })))).toBe(404);
    expect(await status(personalVideosPost(ev(BOB, '/x', { id: 'pb' }, { action: 'add', videoId: 'vPU' })))).toBe(404);
    expect(await status(personalVideosPost(ev(BOB, '/x', { id: 'pb' }, { action: 'add', videoId: 'nope' })))).toBe(404);
    expect(await status(personalVideosPost(ev(BOB, '/x', { id: 'pb' }, { action: 'add', videoId: 'vPH' })))).toBe(200);
    expect(db.prepare("SELECT video_id FROM personal_playlist_videos WHERE playlist_id = 'pb'").all()).toEqual([{ video_id: 'vPH' }]);
  });

  it('the owner no longer sees a video whose access was revoked; an admin still does', async () => {
    personalPlaylist('pb', 'bob', 'private', ['vP', 'vPH', 'vU']);
    const ids = (r: any) => r.videos.map((v: any) => v.id);
    expect(ids(await personalGet(ev(BOB, '/x', { id: 'pb' })))).toEqual(['vP', 'vPH']);
    expect(ids(await playlistGet(ev(BOB, '/x', { id: 'pb' })))).toEqual(['vP', 'vPH']);
    expect(ids(await personalGet(ev(ADMIN, '/x', { id: 'pb' })))).toEqual(['vP', 'vPH', 'vU']);
    db.prepare("UPDATE videos SET visibility = 'ultra_private' WHERE id = 'vPH'").run();
    expect(ids(await personalGet(ev(BOB, '/x', { id: 'pb' })))).toEqual(['vP']);
  });

  it('list counts and thumbnails only cover videos the viewer can see; share tokens stay with the owner', async () => {
    personalPlaylist('pc', 'carol', 'public', ['vPU', 'vU', 'vP']);
    personalPlaylist('pb', 'bob', 'private', ['vP']);
    const asBob = (await personalIndex(ev(BOB, '/api/playlists/personal'))) as any;
    const carols = asBob.playlists.find((p: any) => p.id === 'pc');
    expect(carols.video_count).toBe(1);
    expect(carols.thumbnail_path).toBe('/media/vP.jpg');
    expect(carols.share_token).toBeUndefined();
    expect(asBob.playlists.find((p: any) => p.id === 'pb').share_token).toBe('share-pb');
    const asAdmin = (await personalIndex(ev(ADMIN, '/api/playlists/personal'))) as any;
    expect(asAdmin.playlists.find((p: any) => p.id === 'pc').video_count).toBe(3);

    const read = (await personalGet(ev(BOB, '/x', { id: 'pc' }))) as any;
    expect(read.playlist.share_token).toBeUndefined();
    expect(read.videos.map((v: any) => v.id)).toEqual(['vP']);
    const read2 = (await playlistGet(ev(BOB, '/x', { id: 'pc' }))) as any;
    expect(read2.playlist.share_token).toBeUndefined();
  });
});

describe('internal fields (M1, M3)', () => {
  const INTERNAL = ['share_token', 'last_error', 'retry_count', 'priority', 'is_manually_queued', 'download_speed', 'download_eta'];

  it('video detail: members and guests get no share token nor internal fields; admins do', async () => {
    const asBob = (await videoGet(ev(BOB, '/api/videos/vPH', { id: 'vPH' }))) as any;
    for (const f of INTERNAL) expect(asBob.video, f).not.toHaveProperty(f);
    expect(asBob.video.title).toBe('Private in public');
    const asGuest = (await videoGet(ev(undefined, '/api/videos/vP', { id: 'vP' }))) as any;
    for (const f of INTERNAL) expect(asGuest.video, f).not.toHaveProperty(f);
    expect(asGuest.comments[0]).toEqual(expect.objectContaining({ id: 'cm1', text: 'hi' }));
    const asAdmin = (await videoGet(ev(ADMIN, '/api/videos/vPH', { id: 'vPH' }))) as any;
    expect(asAdmin.video.share_token).toBe('tokPH');
    expect(asAdmin.video.last_error).toBe('yt-dlp stderr /srv/x');
  });

  it('video list: only admins receive share tokens', async () => {
    for (const cookie of [undefined, BOB]) {
      const r = (await videosIndex(ev(cookie, '/api/videos?status=completed'))) as any;
      expect(r.videos.length).toBeGreaterThan(0);
      for (const v of r.videos) expect(v).not.toHaveProperty('share_token');
    }
    const r = (await videosIndex(ev(ADMIN, '/api/videos'))) as any;
    expect(r.videos.find((v: any) => v.id === 'vPH').share_token).toBe('tokPH');
  });

  it('channel detail: no server paths, import errors or download options for non-admins', async () => {
    for (const cookie of [undefined, BOB]) {
      const r = (await channelGet(ev(cookie, '/api/channels/chP', { id: 'chP' }))) as any;
      for (const f of ['custom_save_path', 'import_error', 'date_after', 'download_videos', 'download_shorts', 'download_lives', 'sync_status']) {
        expect(r.channel, f).not.toHaveProperty(f);
      }
      expect(r.channel.title).toBe('Public Channel');
    }
    const r = (await channelGet(ev(ADMIN, '/api/channels/chP', { id: 'chP' }))) as any;
    expect(r.channel.custom_save_path).toBe('/srv/secret/path');
  });
});

describe('counts cover visible videos only (M4)', () => {
  it('channel detail stats', async () => {
    const guest = (await channelGet(ev(undefined, '/api/channels/chP', { id: 'chP' }))) as any;
    expect(guest.stats).toMatchObject({ totalCount: 2, completedCount: 1, totalDuration: 100 });
    const bob = (await channelGet(ev(BOB, '/api/channels/chP', { id: 'chP' }))) as any;
    expect(bob.stats).toMatchObject({ totalCount: 3, completedCount: 2 });
    const admin = (await channelGet(ev(ADMIN, '/api/channels/chP', { id: 'chP' }))) as any;
    expect(admin.stats).toMatchObject({ totalCount: 4, completedCount: 3 });
  });

  it('channel list counts', async () => {
    const find = (r: any) => r.channels.find((c: any) => c.id === 'chP');
    expect(find(await channelsIndex(ev(undefined, '/api/channels')))).toMatchObject({ completed_count: 1, total_count: 2 });
    expect(find(await channelsIndex(ev(BOB, '/api/channels')))).toMatchObject({ completed_count: 2, total_count: 3 });
    expect(find(await channelsIndex(ev(ADMIN, '/api/channels')))).toMatchObject({ completed_count: 3, total_count: 4 });
  });

  it('channel playlist video counts', async () => {
    const count = async (cookie?: string) => ((await channelPlaylists(ev(cookie, '/x', { id: 'chP' }))) as any).playlists[0].video_count;
    expect(await count()).toBe(1);
    expect(await count(BOB)).toBe(2);
    expect(await count(ADMIN)).toBe(3);
  });
});

describe('inaccessible resources answer 404 like missing ones (L5)', () => {
  beforeEach(() => {
    db.prepare("INSERT INTO music_artists (id, name, visibility, created_at) VALUES ('aU', 'Ultra artist', 'ultra_private', 0)").run();
    db.prepare("INSERT INTO music_albums (id, artist_id, title, source, created_at) VALUES ('alU', 'aU', 'Ultra album', 'manual', 0)").run();
    db.prepare("INSERT INTO music_tracks (id, artist_id, album_id, title, download_status, created_at) VALUES ('tU', 'aU', 'alU', 'Song', 'completed', 0)").run();
    db.prepare("INSERT INTO podcast_shows (id, feed_url, title, visibility, created_at) VALUES ('sU', 'https://example.invalid/f', 'Ultra show', 'ultra_private', 0)").run();
  });

  it.each([
    ['video', videoGet, 'vU', 'nope', ''],
    ['channel', channelGet, 'chU', 'nope', ''],
    ['channel playlists', channelPlaylists, 'chU', 'nope', ''],
    ['album', albumGet, 'alU', 'nope', ''],
    ['artist', artistGet, 'aU', 'nope', ''],
    ['artist overview', artistOverview, 'aU', 'nope', ''],
    ['artist songs', artistSongs, 'aU', 'nope', ''],
    ['artist tracks', artistTracks, 'aU', 'nope', '?albumId=none'],
    ['show', showGet, 'sU', 'nope', ''],
    ['show episodes', showEpisodes, 'sU', 'nope', ''],
  ])('%s', async (_name, handler: any, hidden, missing, query) => {
    for (const cookie of [undefined, BOB]) {
      expect(await status(handler(ev(cookie, `/x${query}`, { id: hidden })))).toBe(404);
      expect(await status(handler(ev(cookie, `/x${query}`, { id: missing })))).toBe(404);
    }
    expect(await status(handler(ev(ADMIN, `/x${query}`, { id: hidden })))).toBe(200);
  });
});

describe('actions on hidden items answer 404 like missing ones (R5)', () => {
  beforeEach(() => {
    db.prepare("INSERT INTO music_artists (id, name, visibility, created_at) VALUES ('aU', 'Ultra artist', 'ultra_private', 0)").run();
    db.prepare("INSERT INTO music_albums (id, artist_id, title, source, created_at) VALUES ('alU', 'aU', 'Ultra album', 'manual', 0)").run();
    db.prepare("INSERT INTO music_tracks (id, artist_id, album_id, title, download_status, created_at) VALUES ('tU', 'aU', 'alU', 'Song', 'completed', 0)").run();
    personalPlaylist('ppHidden', 'carol');
  });

  it('track play', async () => {
    for (const cookie of [undefined, BOB]) {
      expect(await status(trackPlay(mockEvent(cookie, { method: 'POST', params: { id: 'tU' } })))).toBe(404);
      expect(await status(trackPlay(mockEvent(cookie, { method: 'POST', params: { id: 'nope' } })))).toBe(404);
    }
    expect(await status(trackPlay(mockEvent(ADMIN, { method: 'POST', params: { id: 'tU' } })))).toBe(200);
  });

  it('channel subscribe', async () => {
    expect(await status(channelSubscribe(mockEvent(BOB, { method: 'POST', params: { id: 'chU' } })))).toBe(404);
    expect(await status(channelSubscribe(mockEvent(BOB, { method: 'POST', params: { id: 'nope' } })))).toBe(404);
    expect(await status(channelSubscribe(mockEvent(ADMIN, { method: 'POST', params: { id: 'chU' } })))).toBe(200);
  });

  it.each([
    ['channel playlist route (personal id)', playlistGet],
    ['personal playlist', personalGet],
  ])('%s: a private playlist of someone else', async (_name, handler: any) => {
    for (const cookie of [undefined, BOB]) {
      expect(await status(handler(ev(cookie, '/x', { id: 'ppHidden' })))).toBe(404);
      expect(await status(handler(ev(cookie, '/x', { id: 'nope' })))).toBe(404);
    }
    expect(await status(handler(ev(CAROL, '/x', { id: 'ppHidden' })))).toBe(200);
    expect(await status(handler(ev(undefined, '/x?token=share-ppHidden', { id: 'ppHidden' })))).toBe(200);
  });

  it('editing a private playlist of someone else', async () => {
    expect(await status(personalDelete(mockEvent(BOB, { method: 'DELETE', params: { id: 'ppHidden' } })))).toBe(404);
    expect(await status(personalVideosPost(ev(BOB, '/x', { id: 'ppHidden' }, { videoId: 'vP' })))).toBe(404);
  });
});

describe('GET /api/videos parameters (L6)', () => {
  it.each(['limit=abc', 'limit=-1', 'limit=0', 'limit=101', 'limit=1.5', 'page=0', 'page=-2', 'page=x', 'offset=-1'])('%s is a 400', async (q) => {
    expect(await status(videosIndex(ev(undefined, `/api/videos?${q}`)))).toBe(400);
  });

  it('a non-default status filter is admin-only', async () => {
    for (const s of ['all', 'pending', 'failed', 'downloading']) {
      expect(await status(videosIndex(ev(undefined, `/api/videos?status=${s}`)))).toBe(403);
      expect(await status(videosIndex(ev(BOB, `/api/videos?status=${s}`)))).toBe(403);
      expect(await status(videosIndex(ev(ADMIN, `/api/videos?status=${s}`)))).toBe(200);
    }
  });

  it('paging the default feed with one seed shows every video exactly once', async () => {
    const now = Date.now();
    for (let i = 0; i < 140; i++) {
      db.prepare("INSERT INTO videos (id, title, channel_id, download_status, view_count, created_at) VALUES (?, ?, 'chP', 'completed', ?, ?)")
        .run(`f${i}`, `Feed ${i}`, (i * 37) % 11, now - (i % 5) * 1000);
    }
    for (const cookie of [undefined, BOB]) {
      const seen: string[] = [];
      let total = 0;
      for (let page = 1; page <= 8; page++) {
        const r = (await videosIndex(ev(cookie, `/api/videos?page=${page}&limit=20&seed=12345`))) as any;
        total = r.pagination.total;
        seen.push(...r.videos.map((v: any) => v.id));
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.length).toBe(total);
      // Same seed, same order.
      const again = (await videosIndex(ev(cookie, '/api/videos?page=1&limit=20&seed=12345'))) as any;
      expect(again.videos.map((v: any) => v.id)).toEqual(seen.slice(0, 20));
    }
  });
});

describe('short recommendations (admin filter)', () => {
  it('an admin is recommended shorts from every channel; a member only what they may see', async () => {
    const ids = async (cookie: string) => ((await recommendGet(ev(cookie, '/api/videos/recommend'))) as any).videos.map((v: any) => v.id);
    expect(await ids(ADMIN)).toContain('sU');
    expect(await ids(BOB)).not.toContain('sU');
  });
});
