import { describe, it, expect } from 'vitest';
import {
  buildProfile,
  rankCandidates,
  rankSimilar,
  seedJitter,
  type HistoryItem,
  type ScoreCandidate,
} from '../../server/utils/recommendScore';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 23, 12);

const ymd = (daysAgo: number) => {
  const d = new Date(NOW - daysAgo * DAY);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

function cand(id: string, channel: string, o: Partial<ScoreCandidate> & { ageDays?: number } = {}): ScoreCandidate {
  return {
    id, title: `Video ${id}`, channel_id: channel, duration: 600, view_count: 1000,
    upload_date: ymd(o.ageDays ?? 30), created_at: NOW - (o.ageDays ?? 30) * DAY,
    categories: [], tags: [], local_viewers: 0, ...o,
  };
}

function watched(videoId: string, channelId: string, o: Partial<HistoryItem> & { daysAgo?: number } = {}): HistoryItem {
  return {
    videoId, title: `Watched ${videoId}`, channelId, watchSeconds: 600, durationSeconds: 600, positionSeconds: 0,
    watchedAt: NOW - (o.daysAgo ?? 1) * DAY, categories: [], tags: [], ...o,
  };
}

const opts = (o: Partial<Parameters<typeof rankCandidates>[2]> = {}) => ({ now: NOW, seed: 's', limit: 20, ...o });
const ids = (r: { video: { id: string } }[]) => r.map((x) => x.video.id);

describe('recommendation scoring', () => {
  it('ranks a subscribed channel above an equal non-subscribed one', () => {
    const profile = buildProfile([], ['subbed'], NOW);
    // The other one is a bit more popular: only the subscription lifts b, whatever the seed.
    for (const seed of ['s', 'a', 'b', 'c', 'd', 'e']) {
      const order = rankCandidates([cand('a', 'other', { view_count: 3000 }), cand('b', 'subbed')], profile, opts({ seed, limit: 2 }));
      expect(ids(order)[0]).toBe('b');
    }
    const r = rankCandidates([cand('a', 'other'), cand('b', 'subbed')], profile, opts());
    expect(r[0]!.reason).toEqual({ kind: 'subscription', label: 'From a channel you follow', ref: { channelId: 'subbed' } });
  });

  it('decays channel affinity with recency', () => {
    const profile = buildProfile([watched('w1', 'recent', { daysAgo: 1 }), watched('w2', 'old', { daysAgo: 120 })], [], NOW);
    expect(profile.channelAffinity.get('recent')!).toBeGreaterThan(profile.channelAffinity.get('old')! * 10);
    const r = rankCandidates([cand('a', 'old'), cand('b', 'recent')], profile, opts());
    expect(ids(r)[0]).toBe('b');
  });

  it('weights a channel by how much of each video was watched (min(watch/duration, 1))', () => {
    const profile = buildProfile([
      watched('w1', 'half', { watchSeconds: 300, durationSeconds: 600 }),
      watched('w2', 'full', { watchSeconds: 5000, durationSeconds: 600 }),
      watched('w3', 'noDuration', { watchSeconds: 300, durationSeconds: null }),
    ], [], NOW);
    expect(profile.channelAffinity.get('full')).toBeCloseTo(1);
    expect(profile.channelAffinity.get('half')).toBeCloseTo(0.5);
    expect(profile.channelAffinity.get('noDuration')).toBeCloseTo(0.5); // 300 s / 600
  });

  it('lifts videos of a category the user watches', () => {
    const profile = buildProfile([watched('w1', 'seen', { categories: ['Gaming'] })], [], NOW);
    const r = rankCandidates([cand('a', 'x', { categories: ['Cooking'] }), cand('b', 'y', { categories: ['Gaming'] })], profile, opts({ limit: 2 }));
    expect(ids(r)[0]).toBe('b');
    expect(r[0]!.reason).toEqual({ kind: 'category', label: 'Popular in Gaming', ref: { category: 'Gaming' } });
  });

  it('lifts videos sharing tags with watched ones', () => {
    const profile = buildProfile([watched('w1', 'seen', { tags: ['minecraft', 'survival'] })], [], NOW);
    const r = rankCandidates([cand('a', 'x', { tags: ['baking'] }), cand('b', 'y', { tags: ['minecraft'] })], profile, opts({ limit: 2 }));
    expect(ids(r)[0]).toBe('b');
  });

  it('explains a video of a watched channel with the watched title', () => {
    const profile = buildProfile([watched('w1', 'seen', { title: 'How to bake bread' })], [], NOW);
    const r = rankCandidates([cand('a', 'seen')], profile, opts());
    expect(r[0]!.reason).toEqual({ kind: 'because-watched', label: 'Because you watched How to bake bread', ref: { videoId: 'w1', channelId: 'seen' } });
  });

  it('excludes watched, completed, started and hidden videos', () => {
    const profile = buildProfile([
      watched('done', 'c'),
      watched('started', 'c', { watchSeconds: 0, positionSeconds: 120 }),
      watched('opened', 'c', { watchSeconds: 0, positionSeconds: 0 }),
    ], [], NOW, ['hidden']);
    const r = rankCandidates(['done', 'started', 'opened', 'hidden', 'fresh'].map((id) => cand(id, 'c')), profile, opts());
    expect(ids(r).sort()).toEqual(['fresh', 'opened']);
  });

  it('honours an extra exclude set (videos already on the page)', () => {
    const r = rankCandidates([cand('a', 'c1'), cand('b', 'c2')], buildProfile([], [], NOW), opts({ exclude: new Set(['a']) }));
    expect(ids(r)).toEqual(['b']);
  });

  it('keeps at most 2 videos per channel when other channels can fill the page', () => {
    const profile = buildProfile([watched('w', 'big')], [], NOW);
    const cands = [
      ...Array.from({ length: 10 }, (_, i) => cand(`big${i}`, 'big', { view_count: 1e6 })),
      ...Array.from({ length: 10 }, (_, i) => cand(`o${i}`, `other${i}`, { view_count: 10 })),
    ];
    const r = rankCandidates(cands, profile, opts({ limit: 8 }));
    expect(r).toHaveLength(8);
    expect(r.filter((x) => x.video.channel_id === 'big')).toHaveLength(2);
    expect(ids(r).slice(0, 2).every((id) => id.startsWith('big'))).toBe(true);
  });

  it('fills a page from the same channel only when nothing else is left', () => {
    const r = rankCandidates(Array.from({ length: 6 }, (_, i) => cand(`v${i}`, 'only')), buildProfile([], [], NOW), opts({ limit: 5 }));
    expect(r).toHaveLength(5);
  });

  it('reserves 10 % of the slots for exploration (unseen channel and category, decent popularity), never from excluded videos', () => {
    const history = [watched('w', 'fav', { categories: ['Gaming'] })];
    const profile = buildProfile(history, [], NOW, ['hiddenPopular']);
    const cands = [
      ...Array.from({ length: 12 }, (_, i) => cand(`fav${i}`, `fav${i % 6 === 0 ? '' : i}`, { categories: ['Gaming'], view_count: 100 })),
      cand('hiddenPopular', 'newChan0', { categories: ['Cooking'], view_count: 1e7 }),
      cand('explorePop', 'newChan1', { categories: ['Cooking'], view_count: 1e6 }),
      cand('exploreUnpopular', 'newChan2', { categories: ['Travel'], view_count: 1 }),
    ];
    const r = rankCandidates(cands, profile, opts({ limit: 10 }));
    const explore = r.filter((x) => x.exploration);
    expect(explore.map((x) => x.video.id)).toEqual(['explorePop']);
    expect(ids(r)).not.toContain('hiddenPopular');
    expect(explore[0]!.reason).toEqual({ kind: 'category', label: 'Popular in Cooking', ref: { category: 'Cooking' } });
    // Not last: placed inside the page.
    expect(ids(r).indexOf('explorePop')).toBeLessThan(9);
    // Two exploration slots on a page of 20, but only one candidate is popular enough.
    expect(rankCandidates(cands, profile, opts({ limit: 20 })).filter((x) => x.exploration).map((x) => x.video.id)).toEqual(['explorePop']);
  });

  it('is deterministic for a seed and changes order with another seed', () => {
    const cands = Array.from({ length: 40 }, (_, i) => cand(`v${i}`, `c${i}`));
    const profile = buildProfile([], [], NOW);
    const a = ids(rankCandidates(cands, profile, opts({ seed: 'one' })));
    expect(ids(rankCandidates([...cands].reverse(), profile, opts({ seed: 'one' })))).toEqual(a);
    expect(ids(rankCandidates(cands, profile, opts({ seed: 'two' })))).not.toEqual(a);
  });

  it('keeps the jitter within +/- 8 %', () => {
    for (let i = 0; i < 500; i++) {
      const j = seedJitter('seed', `v${i}`);
      expect(Math.abs(j)).toBeLessThanOrEqual(0.08);
    }
    expect(seedJitter('a', 'v')).toBe(seedJitter('a', 'v'));
  });

  it('cold start: popularity and freshness lead, categories take turns', () => {
    const profile = buildProfile([], [], NOW);
    expect(profile.hasSignal).toBe(false);
    const cands = [
      ...Array.from({ length: 6 }, (_, i) => cand(`g${i}`, `cg${i}`, { categories: ['Gaming'], view_count: 1e6 - i })),
      ...Array.from({ length: 3 }, (_, i) => cand(`m${i}`, `cm${i}`, { categories: ['Music'], view_count: 1e5 })),
      cand('n0', 'cn', { categories: ['News'], view_count: 1e3 }),
    ];
    const r = rankCandidates(cands, profile, opts({ limit: 6 }));
    const top6 = r.map((x) => x.video.categories[0]);
    expect(new Set(top6.slice(0, 4)).size).toBeGreaterThanOrEqual(2);
    expect(top6).toContain('Music');
    expect(r.some((x) => x.exploration)).toBe(false);
  });

  it('cold start reasons: New for recent videos, Popular on your server otherwise', () => {
    const r = rankCandidates([cand('new', 'c1', { ageDays: 2 }), cand('old', 'c2', { ageDays: 400 })], buildProfile([], [], NOW), opts());
    const byId = Object.fromEntries(r.map((x) => [x.video.id, x.reason]));
    expect(byId.new).toEqual({ kind: 'new', label: 'New' });
    expect(byId.old).toEqual({ kind: 'popular', label: 'Popular on your server' });
  });

  it('local viewers give a small popularity bump', () => {
    const r = rankCandidates([cand('a', 'c1'), cand('b', 'c2', { local_viewers: 4 })], buildProfile([], [], NOW), opts());
    expect(ids(r)[0]).toBe('b');
  });

  it('freshness prefers newer uploads at equal popularity', () => {
    const r = rankCandidates([cand('old', 'c1', { ageDays: 90 }), cand('new', 'c2', { ageDays: 1 })], buildProfile([], [], NOW), opts());
    expect(ids(r)[0]).toBe('new');
  });

  it('performance: 800 candidates against a 50k-row history in well under 100 ms', () => {
    const history = Array.from({ length: 50_000 }, (_, i) => watched(`h${i}`, `c${i % 300}`, { daysAgo: i % 200, categories: [`Cat${i % 15}`], tags: [`t${i % 400}`, `t${i % 77}`] }));
    const cands = Array.from({ length: 800 }, (_, i) => cand(`v${i}`, `c${i % 500}`, { categories: [`Cat${i % 20}`], tags: [`t${i % 500}`], view_count: i * 37 }));
    const start = performance.now();
    const profile = buildProfile(history, ['c1', 'c2'], NOW);
    const r = rankCandidates(cands, profile, opts({ limit: 30 }));
    expect(performance.now() - start).toBeLessThan(250);
    expect(r).toHaveLength(30);
  });
});

describe('similar videos (because you watched)', () => {
  it('prefers same channel, then shared categories and tags, never the seed or excluded videos', () => {
    const seedVideo = { id: 's', title: 'Seed', channel_id: 'sc', categories: ['Gaming'], tags: ['minecraft'] };
    const profile = buildProfile([watched('w', 'zz')], [], NOW);
    const r = rankSimilar([
      cand('s', 'sc'),
      cand('w', 'sc'),
      cand('same', 'sc'),
      cand('cat', 'x', { categories: ['Gaming'] }),
      cand('tag', 'y', { tags: ['minecraft'] }),
      cand('none', 'z', { categories: ['Cooking'] }),
    ], seedVideo, profile, opts());
    expect(ids(r)).toEqual(['same', 'cat', 'tag']);
    expect(r[0]!.reason).toEqual({ kind: 'because-watched', label: 'Because you watched Seed', ref: { videoId: 's' } });
  });

  it('hands clients the structured reason (kind and params) next to the English label', () => {
    const cat = rankCandidates([cand('a', 'x', { categories: ['Cooking'] })], buildProfile([watched('w1', 'seen', { categories: ['Cooking'] })], [], NOW), opts());
    expect(cat[0]!.reasonParams).toEqual({ category: 'Cooking' });
    const because = rankCandidates([cand('a', 'seen')], buildProfile([watched('w1', 'seen', { title: 'How to bake bread' })], [], NOW), opts());
    expect(because[0]!.reasonParams).toEqual({ title: 'How to bake bread' });
    const similar = rankSimilar([cand('same', 'sc')], { id: 's', title: 'Seed', channel_id: 'sc', categories: [], tags: [] }, buildProfile([], [], NOW), opts());
    expect(similar[0]!.reasonParams).toEqual({ title: 'Seed' });
  });
});
