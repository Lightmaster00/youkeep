import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getRecommendedVideos } from '../../server/utils/recommend';
import { createTestDb, insertChannel, insertVideo, insertUserHistory, insertHiddenVideo } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe('getRecommendedVideos', () => {
  it('filters by type: short returns only is_short videos', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: true, uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    const results = getRecommendedVideos(db, 'u1', { type: 'short', limit: 15 });
    expect(results.map(v => v.id)).toEqual(['v1']);
  });

  it('filters by type: video returns only long-form videos', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: true, uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    const results = getRecommendedVideos(db, 'u1', { type: 'video', limit: 15 });
    expect(results.map(v => v.id)).toEqual(['v2']);
  });

  it('type: all returns both shorts and long-form videos', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: true, uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    const results = getRecommendedVideos(db, 'u1', { type: 'all', limit: 15 });
    expect(results.map(v => v.id).sort()).toEqual(['v1', 'v2']);
  });

  it('excludes hidden videos', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    insertHiddenVideo(db, { userId: 'u1', videoId: 'v1' });
    const results = getRecommendedVideos(db, 'u1', { type: 'video', limit: 15 });
    expect(results).toHaveLength(0);
  });

  it('excludes videos not in completed status', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: false, downloadStatus: 'downloading', uploadDate: '20260101' });
    const results = getRecommendedVideos(db, 'u1', { type: 'video', limit: 15 });
    expect(results).toHaveLength(0);
  });

  it('respects the limit', () => {
    insertChannel(db, { id: 'c1' });
    for (let i = 0; i < 5; i++) {
      insertVideo(db, { id: `v${i}`, channelId: 'c1', isShort: false, uploadDate: '20260101' });
    }
    const results = getRecommendedVideos(db, 'u1', { type: 'video', limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('ranks a video from a heavily-watched channel above one from an unwatched channel', () => {
    insertChannel(db, { id: 'c1' });
    insertChannel(db, { id: 'c2' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c2', isShort: false, uploadDate: '20260101' });
    // Heavy watch history on c1 dwarfs the +/-20% random factor applied to scores.
    insertUserHistory(db, { userId: 'u1', videoId: 'v1', watchTimeSeconds: 100000 });
    const results = getRecommendedVideos(db, 'u1', { type: 'video', limit: 15 });
    expect(results[0].id).toBe('v1');
  });
});
