import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  backoffDelayMs,
  cleanTrackTitle,
  isTransientMatchError,
  keySimilarity,
  largeArtworkUrl,
  normaliseKey,
  parseCollectionName,
  pickBestCandidate,
  RequestThrottle,
  searchItunesSong,
  toItunesMatch,
} from '../../server/utils/albumMatch';

function song(over: Record<string, any> = {}) {
  return {
    wrapperType: 'track',
    kind: 'song',
    artistName: 'Daft Punk',
    trackName: 'Get Lucky',
    collectionId: 1,
    collectionName: 'Random Access Memories',
    releaseDate: '2013-05-17T07:00:00Z',
    trackNumber: 8,
    primaryGenreName: 'Dance',
    artworkUrl100: 'https://is1.mzstatic.com/image/thumb/a/100x100bb.jpg',
    ...over,
  };
}

describe('normaliseKey', () => {
  it('ignores case, diacritics, punctuation and extra spaces', () => {
    expect(normaliseKey('  Beyoncé -- HALO!! ')).toBe('beyonce halo');
    expect(normaliseKey('Beyoncé')).toBe('beyonce');
    expect(normaliseKey('Simon & Garfunkel')).toBe('simon and garfunkel');
    expect(normaliseKey(null)).toBe('');
  });
});

describe('cleanTrackTitle', () => {
  it.each([
    ['Get Lucky (Official Video)', 'Get Lucky'],
    ['Get Lucky (Official Audio)', 'Get Lucky'],
    ['Get Lucky [Official Music Video]', 'Get Lucky'],
    ['Get Lucky (Lyric Video)', 'Get Lucky'],
    ['Get Lucky (Visualizer)', 'Get Lucky'],
    ['Get Lucky [HD]', 'Get Lucky'],
    ['Get Lucky [Lyrics]', 'Get Lucky'],
    ['Get Lucky | Official Video', 'Get Lucky'],
    ['Get Lucky ft. Pharrell Williams', 'Get Lucky'],
    ['Get Lucky (feat. Pharrell Williams) [Official Video]', 'Get Lucky'],
    ['Get Lucky featuring Pharrell Williams', 'Get Lucky'],
    ['Daft Punk - Get Lucky (Official Video)', 'Get Lucky'],
    ['Daft Punk & Pharrell Williams – Get Lucky', 'Get Lucky'],
    ['  Get    Lucky  ', 'Get Lucky'],
  ])('%s -> %s', (input, expected) => {
    expect(cleanTrackTitle(input, 'Daft Punk')).toBe(expected);
  });

  it('keeps a dash that is part of the title and words that only contain "ft"', () => {
    expect(cleanTrackTitle('Left Behind - Live', 'Daft Punk')).toBe('Left Behind - Live');
    expect(cleanTrackTitle('Daftendirekt', 'Daft Punk')).toBe('Daftendirekt');
  });

  it('normalises to NFC and never returns an empty title', () => {
    expect(cleanTrackTitle('Beyoncé', 'X')).toBe('Beyoncé');
    expect(cleanTrackTitle('(Official Video)', 'X')).toBe('(Official Video)');
  });
});

describe('helpers', () => {
  it('derives the collection type and removes the suffix', () => {
    expect(parseCollectionName('Get Lucky - Single')).toEqual({ title: 'Get Lucky', type: 'single' });
    expect(parseCollectionName('Homework Remixes - EP')).toEqual({ title: 'Homework Remixes', type: 'ep' });
    expect(parseCollectionName('Random Access Memories')).toEqual({ title: 'Random Access Memories', type: 'album' });
    expect(parseCollectionName('Single - Ladies')).toEqual({ title: 'Single - Ladies', type: 'album' });
  });

  it('swaps the artwork for the 600x600 version', () => {
    expect(largeArtworkUrl('https://x/100x100bb.jpg')).toBe('https://x/600x600bb.jpg');
    expect(largeArtworkUrl(undefined)).toBeNull();
  });

  it('measures similarity from 0 to 1', () => {
    expect(keySimilarity('get lucky', 'get lucky')).toBe(1);
    expect(keySimilarity('abcdefghij', 'abcdefghix')).toBeCloseTo(0.9);
    expect(keySimilarity('abc', 'xyz')).toBe(0);
  });

  it('maps a result', () => {
    expect(toItunesMatch(song({ collectionName: 'Get Lucky - Single' }))).toEqual({
      collectionId: '1',
      collectionName: 'Get Lucky',
      albumType: 'single',
      artworkUrl: 'https://is1.mzstatic.com/image/thumb/a/600x600bb.jpg',
      releaseYear: 2013,
      trackNumber: 8,
      genre: 'Dance',
    });
    expect(toItunesMatch(song({ trackNumber: undefined, primaryGenreName: '', releaseDate: undefined }))).toMatchObject({ trackNumber: null, genre: null, releaseYear: null });
  });

  it('classifies transient errors and grows the backoff exponentially', () => {
    expect(isTransientMatchError({ statusCode: 429 })).toBe(true);
    expect(isTransientMatchError({ status: 503 })).toBe(true);
    expect(isTransientMatchError(new Error('fetch failed'))).toBe(true);
    expect(isTransientMatchError({ statusCode: 400 })).toBe(false);
    expect(isTransientMatchError({ statusCode: 404 })).toBe(false);
    expect([1, 2, 3, 4].map((n) => backoffDelayMs(n))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(backoffDelayMs(50)).toBe(15 * 60_000);
  });
});

describe('pickBestCandidate', () => {
  it('needs the artist to match (equal, containing or contained)', () => {
    expect(pickBestCandidate([song({ artistName: 'Someone Else' })], 'Daft Punk', 'Get Lucky')).toBeNull();
    expect(pickBestCandidate([song({ artistName: 'Daft Punk & Pharrell Williams' })], 'Daft Punk', 'Get Lucky')).not.toBeNull();
    expect(pickBestCandidate([song({ artistName: 'Daft' })], 'Daft Punk', 'Get Lucky')).not.toBeNull();
  });

  it('needs the title key to be equal, or at least 0.9 similar', () => {
    expect(pickBestCandidate([song({ trackName: 'GET LUCKY!' })], 'Daft Punk', 'Get Lucky')).not.toBeNull();
    expect(pickBestCandidate([song({ trackName: 'Get Lucky (feat. Pharrell Williams)' })], 'Daft Punk', 'Get Lucky')).not.toBeNull();
    // "abcdefghij" vs "abcdefghix": exactly 0.9 is accepted.
    expect(pickBestCandidate([song({ trackName: 'abcdefghix' })], 'Daft Punk', 'abcdefghij')).not.toBeNull();
    // 0.8 is not.
    expect(pickBestCandidate([song({ trackName: 'abcdefghxx' })], 'Daft Punk', 'abcdefghij')).toBeNull();
    expect(pickBestCandidate([song({ trackName: 'Lose Yourself to Dance' })], 'Daft Punk', 'Get Lucky')).toBeNull();
  });

  it('prefers an exact title over a merely similar one', () => {
    const close = song({ trackName: 'Get Luckyy', collectionId: 2, releaseDate: '2000-01-01T00:00:00Z' });
    const exact = song({ collectionId: 3 });
    expect(pickBestCandidate([close, exact], 'Daft Punk', 'Get Lucky').collectionId).toBe(3);
  });

  it('prefers an album over a single or EP of the same title, even a newer one', () => {
    const single = song({ collectionId: 10, collectionName: 'Get Lucky - Single', releaseDate: '2013-04-19T07:00:00Z' });
    const ep = song({ collectionId: 11, collectionName: 'Get Lucky - EP', releaseDate: '2013-04-01T07:00:00Z' });
    const album = song({ collectionId: 12, releaseDate: '2013-05-17T07:00:00Z' });
    expect(pickBestCandidate([single, ep, album], 'Daft Punk', 'Get Lucky').collectionId).toBe(12);
    expect(pickBestCandidate([album, single], 'Daft Punk', 'Get Lucky').collectionId).toBe(12);
  });

  it('prefers the earliest release among equal candidates', () => {
    const later = song({ collectionId: 20, collectionName: 'Greatest Hits', releaseDate: '2020-01-01T00:00:00Z' });
    const earlier = song({ collectionId: 21, releaseDate: '2013-05-17T07:00:00Z' });
    expect(pickBestCandidate([later, earlier], 'Daft Punk', 'Get Lucky').collectionId).toBe(21);
  });

  it('ignores results that are not songs or have no collection', () => {
    expect(pickBestCandidate([song({ kind: 'music-video' }), song({ wrapperType: 'collection' }), song({ collectionId: undefined })], 'Daft Punk', 'Get Lucky')).toBeNull();
    expect(pickBestCandidate([], 'Daft Punk', 'Get Lucky')).toBeNull();
  });
});

describe('searchItunesSong', () => {
  it('searches "<artist> <cleaned title>" through the injected fetcher and maps the best result', async () => {
    const fetcher = vi.fn(async () => [song({ collectionName: 'Get Lucky - Single', collectionId: 5 }), song()]);
    const match = await searchItunesSong('Daft Punk', 'Daft Punk - Get Lucky (Official Video)', fetcher);
    expect(fetcher).toHaveBeenCalledWith('Daft Punk Get Lucky');
    expect(match).toMatchObject({ collectionId: '1', collectionName: 'Random Access Memories', albumType: 'album' });
    expect(await searchItunesSong('Daft Punk', 'Nothing', async () => [song()])).toBeNull();
  });
});

describe('RequestThrottle', () => {
  afterEach(() => vi.useRealTimers());

  it('spaces requests at least 3 s apart', async () => {
    vi.useFakeTimers();
    const throttle = new RequestThrottle(3000);
    const resolved: number[] = [];
    void throttle.wait().then(() => resolved.push(1));
    void throttle.wait().then(() => resolved.push(2));
    void throttle.wait().then(() => resolved.push(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toEqual([1]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(resolved).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(resolved).toEqual([1, 2, 3]);
    // After a long pause the next request goes immediately.
    await vi.advanceTimersByTimeAsync(10_000);
    void throttle.wait().then(() => resolved.push(4));
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toEqual([1, 2, 3, 4]);
  });
});
