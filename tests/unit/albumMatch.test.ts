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
  stripEditionSuffix,
  isDerivativeCollection,
  chooseMatch,
  candidateGroups,
  defaultItunesClient,
  type ItunesClient,
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
    ['Get Lucky (Explicit)', 'Get Lucky'],
    ['Get Lucky [Explicit]', 'Get Lucky'],
    ['Get Lucky (Clean)', 'Get Lucky'],
    ['Get Lucky (Audio)', 'Get Lucky'],
    ['Get Lucky (Video)', 'Get Lucky'],
    ['Get Lucky (Lyrics)', 'Get Lucky'],
    ['Get Lucky (HD)', 'Get Lucky'],
    ['Get Lucky (4K)', 'Get Lucky'],
    ['Get Lucky (Remastered 2011)', 'Get Lucky'],
    ['Get Lucky - Remastered 2011', 'Get Lucky'],
    ['Get Lucky (Radio Edit)', 'Get Lucky'],
    ['Get Lucky (Live at Coachella 2006)', 'Get Lucky'],
    ['Get Lucky [Live]', 'Get Lucky'],
    ['Daft Punk - Get Lucky [HD] (Official Video)', 'Get Lucky'],
    ['Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams', 'Get Lucky'],
    ['Get Lucky (Interlude)', 'Get Lucky (Interlude)'],
    ['Get Lucky (Remix)', 'Get Lucky (Remix)'],
  ])('%s -> %s', (input, expected) => {
    expect(cleanTrackTitle(input, 'Daft Punk')).toBe(expected);
  });

  it('keeps a dash that is part of the title and words that only contain "ft"', () => {
    expect(cleanTrackTitle('Left Behind - Part 2', 'Daft Punk')).toBe('Left Behind - Part 2');
    expect(cleanTrackTitle('Live Forever', 'Daft Punk')).toBe('Live Forever');
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

  it('maps the chosen result', () => {
    expect(pickBestCandidate([song({ collectionName: 'Get Lucky - Single' })], 'Daft Punk', 'Get Lucky')).toEqual({
      collectionId: '1',
      collectionName: 'Get Lucky',
      albumType: 'single',
      artworkUrl: 'https://is1.mzstatic.com/image/thumb/a/600x600bb.jpg',
      releaseYear: 2013,
      trackNumber: 8,
      genre: 'Dance',
    });
    expect(pickBestCandidate([song({ trackNumber: undefined, primaryGenreName: '', releaseDate: undefined })], 'Daft Punk', 'Get Lucky'))
      .toMatchObject({ trackNumber: null, genre: null, releaseYear: null });
  });

  it('strips edition tags from album names', () => {
    expect(stripEditionSuffix('Homework (25th Anniversary Edition)')).toBe('Homework');
    expect(stripEditionSuffix('The Marshall Mathers LP2 (Deluxe)')).toBe('The Marshall Mathers LP2');
    expect(stripEditionSuffix('Discovery [Explicit]')).toBe('Discovery');
    expect(stripEditionSuffix('Abbey Road (Remastered)')).toBe('Abbey Road');
    expect(stripEditionSuffix('Encore (Deluxe Version)')).toBe('Encore');
    expect(stripEditionSuffix('8 Mile (Music From The Motion Picture (Expanded Edition))')).toBe('8 Mile (Music From The Motion Picture)');
    expect(stripEditionSuffix('Speakerboxxx (Interlude)')).toBe('Speakerboxxx (Interlude)');
  });

  it('recognises compilations and derivative releases', () => {
    for (const name of ['Curtain Call: The Hits', 'Greatest Hits', 'The Best of Daft Punk', 'The Collection', 'Anthology', 'The Essentials', 'The Complete Recordings', 'The Very Best', 'Alive (Live)', 'Karaoke Hits Vol. 3', 'A Tribute to Eminem', 'Summer Mix 2010']) {
      expect(isDerivativeCollection(name, 'Song'), name).toBe(true);
    }
    expect(isDerivativeCollection('Daft Club (Remixes)', 'Aerodynamic')).toBe(true);
    expect(isDerivativeCollection('Daft Club (Remixes)', 'Aerodynamic (Slum Village Remix)')).toBe(false);
    for (const name of ['Homework', 'Alive 2007', 'Discovery', 'Mixtape Memories']) {
      expect(isDerivativeCollection(name, 'Song'), name).toBe(false);
    }
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
    expect(pickBestCandidate([close, exact], 'Daft Punk', 'Get Lucky')!.collectionId).toBe('3');
  });

  it('prefers an album over a single or EP of the same title, even a newer one', () => {
    const single = song({ collectionId: 10, collectionName: 'Get Lucky - Single', releaseDate: '2013-04-19T07:00:00Z' });
    const ep = song({ collectionId: 11, collectionName: 'Get Lucky - EP', releaseDate: '2013-04-01T07:00:00Z' });
    const album = song({ collectionId: 12, releaseDate: '2013-05-17T07:00:00Z' });
    expect(pickBestCandidate([single, ep, album], 'Daft Punk', 'Get Lucky')!.collectionId).toBe('12');
    expect(pickBestCandidate([album, single], 'Daft Punk', 'Get Lucky')!.collectionId).toBe('12');
  });

  it('prefers the earliest release among equal candidates', () => {
    const later = song({ collectionId: 20, collectionName: 'Album B', releaseDate: '2020-01-01T00:00:00Z' });
    const earlier = song({ collectionId: 21, collectionName: 'Album A', releaseDate: '2013-05-17T07:00:00Z' });
    expect(pickBestCandidate([later, earlier], 'Daft Punk', 'Get Lucky')!.collectionId).toBe('21');
  });

  it('puts compilations last, even earlier ones', () => {
    const hits = song({ collectionId: 30, collectionName: 'Greatest Hits', releaseDate: '2000-01-01T00:00:00Z' });
    const original = song({ collectionId: 31, collectionName: 'Album', releaseDate: '2013-05-17T07:00:00Z' });
    expect(pickBestCandidate([hits, original], 'Daft Punk', 'Get Lucky')!.collectionId).toBe('31');
    expect(pickBestCandidate([hits], 'Daft Punk', 'Get Lucky')!.collectionId).toBe('30');
  });

  it('rejects live, instrumental and remix recordings of the song', () => {
    for (const trackName of ['Get Lucky (Live)', 'Get Lucky (Instrumental)', 'Get Lucky (Daft Punk Remix)', 'Get Lucky - Live']) {
      expect(pickBestCandidate([song({ trackName })], 'Daft Punk', 'Get Lucky'), trackName).toBeNull();
    }
    expect(pickBestCandidate([song({ trackName: 'Get Lucky (Radio Edit) [Remastered]' })], 'Daft Punk', 'Get Lucky')).not.toBeNull();
  });

  it('keeps a genuine bracketed group only when the iTunes title has it too', () => {
    expect(pickBestCandidate([song({ trackName: 'Intro (Interlude)' })], 'Daft Punk', 'Intro (Interlude)')).not.toBeNull();
    expect(pickBestCandidate([song({ trackName: 'Intro' })], 'Daft Punk', 'Intro (Interlude)')).not.toBeNull();
    expect(pickBestCandidate([song({ trackName: 'Intro (Interlude)' })], 'Daft Punk', 'Intro')).toBeNull();
  });

  it('treats the editions of one album as one album, labelled without the edition tag', () => {
    const deluxe = song({ collectionId: 40, collectionName: 'Homework (25th Anniversary Edition)', releaseDate: '1997-01-01T00:00:00Z' });
    const original = song({ collectionId: 41, collectionName: 'Homework', releaseDate: '1997-01-20T00:00:00Z' });
    const other = song({ collectionId: 42, collectionName: 'Musique', releaseDate: '1997-01-10T00:00:00Z' });
    // Without lookups the song dates decide between albums; within one album the untagged edition wins a tie.
    const collections = new Map([
      ['40', { releaseDate: '1997-01-20T08:00:00Z', trackCount: 31, collectionType: 'Album' }],
      ['41', { releaseDate: '1997-01-20T08:00:00Z', trackCount: 16, collectionType: 'Album' }],
      ['42', { releaseDate: '2006-04-04T07:00:00Z', trackCount: 15, collectionType: 'Album' }],
    ]);
    expect(pickBestCandidate([deluxe, other, original], 'Daft Punk', 'Get Lucky', collections)).toMatchObject({ collectionId: '41', collectionName: 'Homework', releaseYear: 1997 });
  });

  it('uses the looked-up collection dates, and penalises a non-Album collection type', () => {
    const compilationLike = song({ collectionId: 50, collectionName: 'Shady', releaseDate: '2002-10-22T00:00:00Z' });
    const original = song({ collectionId: 51, collectionName: 'Soundtrack', releaseDate: '2002-10-29T00:00:00Z' });
    expect(pickBestCandidate([compilationLike, original], 'Daft Punk', 'Get Lucky')!.collectionId).toBe('50');
    const dated = new Map([
      ['50', { releaseDate: '2014-11-24T08:00:00Z', trackCount: 29, collectionType: 'Album' }],
      ['51', { releaseDate: '2002-10-29T08:00:00Z', trackCount: 16, collectionType: 'Album' }],
    ]);
    expect(pickBestCandidate([compilationLike, original], 'Daft Punk', 'Get Lucky', dated)).toMatchObject({ collectionId: '51', releaseYear: 2002 });
    const typed = new Map([
      ['50', { releaseDate: '2001-01-01T08:00:00Z', trackCount: 29, collectionType: 'Compilation' }],
      ['51', { releaseDate: '2002-10-29T08:00:00Z', trackCount: 16, collectionType: 'Album' }],
    ]);
    expect(pickBestCandidate([compilationLike, original], 'Daft Punk', 'Get Lucky', typed)!.collectionId).toBe('51');
  });

  it('ignores results that are not songs or have no collection', () => {
    expect(pickBestCandidate([song({ kind: 'music-video' }), song({ wrapperType: 'collection' }), song({ collectionId: undefined })], 'Daft Punk', 'Get Lucky')).toBeNull();
    expect(pickBestCandidate([], 'Daft Punk', 'Get Lucky')).toBeNull();
  });
});

describe('chooseMatch details', () => {
  it('prefers a looked-up album over one that was not looked up', () => {
    const groups = candidateGroups([
      song({ collectionId: 60, collectionName: 'Not Looked Up', releaseDate: '1990-01-01T00:00:00Z' }),
      song({ collectionId: 61, collectionName: 'Looked Up', releaseDate: '2005-01-01T00:00:00Z' }),
    ], 'Daft Punk', 'Get Lucky');
    const collections = new Map([['61', { releaseDate: '2005-01-01T00:00:00Z', trackCount: 10, collectionType: 'Album' }]]);
    expect(chooseMatch(groups, collections)!.collectionId).toBe('61');
  });

  it('on a tie, the edition without an edition tag gives the collection id', () => {
    const tagged = song({ collectionId: 70, collectionName: 'Homework (Deluxe)' });
    const plain = song({ collectionId: 71, collectionName: 'Homework' });
    expect(pickBestCandidate([tagged, plain], 'Daft Punk', 'Get Lucky')).toMatchObject({ collectionId: '71', collectionName: 'Homework' });
  });
});

describe('defaultItunesClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for 25 US songs, and looks collections up in one request (no network: $fetch is stubbed)', async () => {
    const fetchMock = vi.fn(async () => ({ results: [{ a: 1 }] }));
    vi.stubGlobal('$fetch', fetchMock);
    expect(await defaultItunesClient.search('Daft Punk Get Lucky')).toEqual([{ a: 1 }]);
    expect(fetchMock).toHaveBeenLastCalledWith('https://itunes.apple.com/search', expect.objectContaining({
      params: { term: 'Daft Punk Get Lucky', entity: 'song', media: 'music', limit: 25, country: 'US', lang: 'en_us' },
      timeout: 8000,
    }));
    await defaultItunesClient.lookup(['1', '2']);
    expect(fetchMock).toHaveBeenLastCalledWith('https://itunes.apple.com/lookup', expect.objectContaining({
      params: { id: '1,2', entity: 'album', country: 'US' },
    }));
    fetchMock.mockResolvedValueOnce(null as any);
    expect(await defaultItunesClient.search('x')).toEqual([]);
  });
});

describe('searchItunesSong', () => {
  const client = (results: any[], lookup: any[] = []) => ({
    search: vi.fn(async () => results),
    lookup: vi.fn(async () => lookup),
  }) satisfies ItunesClient;

  it('searches "<artist> <cleaned title>" through the injected client', async () => {
    const c = client([song({ collectionName: 'Get Lucky - Single', collectionId: 5 }), song()]);
    const match = await searchItunesSong('Daft Punk', 'Daft Punk - Get Lucky (Official Video)', c);
    expect(c.search).toHaveBeenCalledWith('Daft Punk Get Lucky');
    expect(match).toMatchObject({ collectionId: '1', collectionName: 'Random Access Memories', albumType: 'album' });
    expect(await searchItunesSong('Daft Punk', 'Nothing', client([song()]))).toBeNull();
  });

  it('looks up the candidate collections in one request, but not when only one is possible', async () => {
    const one = client([song()]);
    await searchItunesSong('Daft Punk', 'Get Lucky', one);
    expect(one.lookup).not.toHaveBeenCalled();

    const many = client(
      [1, 2, 3, 4, 5].map((n) => song({ collectionId: n, collectionName: `Album ${n}` })),
      [{ wrapperType: 'collection', collectionId: 3, releaseDate: '1990-01-01T00:00:00Z', collectionType: 'Album', trackCount: 9 }],
    );
    expect(await searchItunesSong('Daft Punk', 'Get Lucky', many)).toMatchObject({ collectionId: '3', releaseYear: 1990 });
    expect(many.lookup).toHaveBeenCalledTimes(1);
    expect(many.lookup).toHaveBeenCalledWith(['1', '2', '3', '4']);
  });

  it('rethrows a transient lookup failure, and ignores any other one', async () => {
    const results = [song({ collectionId: 1, collectionName: 'A' }), song({ collectionId: 2, collectionName: 'B' })];
    const failing = (err: any): ItunesClient => ({ search: async () => results, lookup: async () => { throw err; } });
    await expect(searchItunesSong('Daft Punk', 'Get Lucky', failing({ statusCode: 503 }))).rejects.toMatchObject({ statusCode: 503 });
    expect(await searchItunesSong('Daft Punk', 'Get Lucky', failing({ statusCode: 400 }))).toMatchObject({ collectionId: '1' });
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
