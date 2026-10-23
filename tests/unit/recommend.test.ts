import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getBecauseYouWatched, getRecommendedVideos } from '../../server/utils/recommend';
import { createTestDb, insertChannel, insertVideo, insertUserHistory, insertHiddenVideo } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe('getRecommendedVideos', () => {
  it('filters by type: short, video or all', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: true, uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    expect(getRecommendedVideos(db, { id: 'u1', role: 'user' }, { type: 'short', limit: 15 }).map(v => v.id)).toEqual(['v1']);
    expect(getRecommendedVideos(db, { id: 'u1', role: 'user' }, { type: 'video', limit: 15 }).map(v => v.id)).toEqual(['v2']);
    expect(getRecommendedVideos(db, { id: 'u1', role: 'user' }, { type: 'all', limit: 15 }).map(v => v.id).sort()).toEqual(['v1', 'v2']);
  });

  it('excludes hidden videos and videos not in completed status', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c1', isShort: false, downloadStatus: 'downloading', uploadDate: '20260101' });
    insertVideo(db, { id: 'v3', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    insertHiddenVideo(db, { userId: 'u1', videoId: 'v1' });
    expect(getRecommendedVideos(db, { id: 'u1', role: 'user' }, { type: 'video', limit: 15 }).map(v => v.id)).toEqual(['v3']);
    expect(getRecommendedVideos(db, { id: 'u1', role: 'user' }, { type: 'short', limit: 15 })).toEqual([]);
  });

  it('respects the limit', () => {
    insertChannel(db, { id: 'c1' });
    for (let i = 0; i < 5; i++) {
      insertVideo(db, { id: `v${i}`, channelId: 'c1', isShort: false, uploadDate: '20260101' });
    }
    const results = getRecommendedVideos(db, { id: 'u1', role: 'user' }, { type: 'video', limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('ranks a new video of a watched channel above one from an unwatched channel, and never the watched one', () => {
    insertChannel(db, { id: 'c1' });
    insertChannel(db, { id: 'c2' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: false, uploadDate: '20260101', duration: 600 });
    insertVideo(db, { id: 'v2', channelId: 'c1', isShort: false, uploadDate: '20260101', duration: 600 });
    insertVideo(db, { id: 'v3', channelId: 'c2', isShort: false, uploadDate: '20260101', duration: 600 });
    insertUserHistory(db, { userId: 'u1', videoId: 'v1', watchTimeSeconds: 600 });
    const results = getRecommendedVideos(db, { id: 'u1', role: 'user' }, { type: 'video', limit: 15 });
    expect(results.map((v) => v.id)).toEqual(['v2', 'v3']);
    expect(results[0]!.reason).toEqual({ kind: 'because-watched', label: 'Because you watched Video v1', ref: { videoId: 'v1', channelId: 'c1' } });
  });

  it('a guest only gets public videos of public channels', () => {
    insertChannel(db, { id: 'pub' });
    insertChannel(db, { id: 'priv', visibility: 'private' });
    insertVideo(db, { id: 'a', channelId: 'pub' });
    insertVideo(db, { id: 'b', channelId: 'pub', visibility: 'private' });
    insertVideo(db, { id: 'c', channelId: 'priv' });
    expect(getRecommendedVideos(db, null, { type: 'video', limit: 15 }).map((v) => v.id)).toEqual(['a']);
    expect(getRecommendedVideos(db, { id: 'u1', role: 'user' }, { type: 'video', limit: 15 }).map((v) => v.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('leaves out started videos and the exclude list, and drops reasons on request', () => {
    insertChannel(db, { id: 'c1' });
    for (const id of ['a', 'b', 'c']) insertVideo(db, { id, channelId: 'c1', duration: 1000 });
    insertUserHistory(db, { userId: 'u1', videoId: 'a', watchTimeSeconds: 0, positionSeconds: 200 });
    const r = getRecommendedVideos(db, { id: 'u1', role: 'user' }, { type: 'video', limit: 15, exclude: ['b'], reasonLabels: false });
    expect(r.map((v) => v.id)).toEqual(['c']);
    expect(r[0]!.reason).toBeUndefined();
  });

  it('gives the same order for the same seed', () => {
    insertChannel(db, { id: 'c1' });
    for (let i = 0; i < 30; i++) {
      insertChannel(db, { id: `ch${i}` });
      insertVideo(db, { id: `v${i}`, channelId: `ch${i}`, viewCount: 100 });
    }
    const run = (seed: string) => getRecommendedVideos(db, null, { type: 'video', limit: 10, seed }).map((v) => v.id);
    expect(run('x')).toEqual(run('x'));
    expect(run('x')).not.toEqual(run('y'));
  });
});

describe('getBecauseYouWatched', () => {
  it('is seeded by the most recently watched long video', () => {
    insertChannel(db, { id: 'c1' });
    insertChannel(db, { id: 'c2' });
    insertChannel(db, { id: 'c3' });
    insertVideo(db, { id: 'old', channelId: 'c3', categories: ['Music'] });
    insertVideo(db, { id: 'seed', channelId: 'c1', title: 'Seed video', categories: ['Gaming'], tags: ['minecraft'] });
    insertVideo(db, { id: 'sameChannel', channelId: 'c1' });
    insertVideo(db, { id: 'sameCat', channelId: 'c2', categories: ['Gaming'] });
    insertVideo(db, { id: 'music', channelId: 'c2', categories: ['Music'] });
    insertVideo(db, { id: 'shortSeed', channelId: 'c3', isShort: true });
    insertUserHistory(db, { userId: 'u1', videoId: 'old', watchTimeSeconds: 100, watchedAt: 1 });
    insertUserHistory(db, { userId: 'u1', videoId: 'seed', watchTimeSeconds: 100, watchedAt: 2 });
    insertUserHistory(db, { userId: 'u1', videoId: 'shortSeed', watchTimeSeconds: 100, watchedAt: 3 });
    const r = getBecauseYouWatched(db, { id: 'u1', role: 'user' }, { limit: 10 })!;
    expect(r.seed).toEqual({ id: 'seed', title: 'Seed video' });
    expect(r.videos.map((v) => v.id)).toEqual(['sameChannel', 'sameCat']);
    expect(r.videos[0]!.reason!.label).toBe('Because you watched Seed video');
    // Additive structured fields, so a client can word the reason in its own language.
    expect(r.videos[0]!.reasonKind).toBe('because-watched');
    expect(r.videos[0]!.reasonParams).toEqual({ title: 'Seed video' });
  });

  it('is null without any watched video', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'a', channelId: 'c1' });
    expect(getBecauseYouWatched(db, { id: 'u1', role: 'user' }, { limit: 10 })).toBeNull();
  });
});
