import { describe, it, expect } from 'vitest';
import { extractInfoFields } from '../../server/utils/videoInfo';

describe('extractInfoFields', () => {
  it('keeps existing field semantics', () => {
    expect(extractInfoFields({ description: 'd', view_count: 5, upload_date: '20240102', like_count: 3, live_status: 'was_live', duration: 10 }))
      .toEqual({ description: 'd', views: 5, uploadDate: '20240102', likeCount: 3, wasLive: 1, duration: 10 });
    expect(extractInfoFields({ description: '', view_count: 0, like_count: 0, live_status: 'not_live' }))
      .toEqual({ description: null, views: null, uploadDate: null, likeCount: null, wasLive: 0, duration: null });
  });
  it('rounds float durations', () => {
    expect(extractInfoFields({ duration: 61.6 }).duration).toBe(62);
  });
  it('floors tiny positive durations at 1', () => {
    expect(extractInfoFields({ duration: 0.4 }).duration).toBe(1);
  });
  it.each([[undefined], [null], [0], [-5], ['120'], [NaN], [Infinity]])('duration %s -> null', (d) => {
    expect(extractInfoFields({ duration: d }).duration).toBeNull();
  });
});
