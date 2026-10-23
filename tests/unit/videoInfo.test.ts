import { describe, it, expect } from 'vitest';
import { extractInfoFields } from '../../server/utils/videoInfo';

describe('extractInfoFields', () => {
  it('keeps existing field semantics', () => {
    expect(extractInfoFields({ description: 'd', view_count: 5, upload_date: '20240102', like_count: 3, live_status: 'was_live', duration: 10 }))
      .toEqual({ description: 'd', views: 5, uploadDate: '20240102', likeCount: 3, wasLive: 1, duration: 10, categories: [], tags: [] });
    expect(extractInfoFields({ description: '', view_count: 0, like_count: 0, live_status: 'not_live' }))
      .toEqual({ description: null, views: null, uploadDate: null, likeCount: null, wasLive: 0, duration: null, categories: [], tags: [] });
  });

  it('rounds float durations and floors tiny positive ones at 1', () => {
    expect(extractInfoFields({ duration: 61.6 }).duration).toBe(62);
    expect(extractInfoFields({ duration: 0.4 }).duration).toBe(1);
  });

  it.each([[null], [0], [-5], ['120'], [NaN], [Infinity]])('duration %s -> null', (d) => {
    expect(extractInfoFields({ duration: d }).duration).toBeNull();
  });

  it('keeps up to 3 trimmed categories, without duplicates or blanks', () => {
    expect(extractInfoFields({ categories: [' Gaming ', 'Music', 'Gaming', '', 42, 'Education', 'Comedy'] }).categories)
      .toEqual(['Gaming', 'Music', 'Education']);
  });

  it('keeps up to 20 lower-cased tags of at most 40 characters', () => {
    const tags = Array.from({ length: 30 }, (_, i) => `Tag${i}`);
    const out = extractInfoFields({ tags: ['  Minecraft ', 'MINECRAFT', 'x'.repeat(41), null, ...tags] }).tags;
    expect(out).toHaveLength(20);
    expect(out[0]).toBe('minecraft');
    expect(out.filter((t) => t === 'minecraft')).toHaveLength(1);
    expect(out.every((t) => t.length <= 40 && t === t.toLowerCase())).toBe(true);
    expect(out).not.toContain('x'.repeat(41));
  });

  it('cuts a category longer than 40 characters', () => {
    expect(extractInfoFields({ categories: ['C'.repeat(60)] }).categories).toEqual(['C'.repeat(40)]);
  });

  it.each([[undefined], ['Gaming'], [{}], [null]])('categories/tags %s that are not arrays give []', (v) => {
    expect(extractInfoFields({ categories: v, tags: v })).toMatchObject({ categories: [], tags: [] });
  });
});
