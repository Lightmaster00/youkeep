import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  normalizeItunesResult,
  normalizePodcastIndexResult,
  normalizeListenNotesResult,
  mergeShowCandidates,
  computePodcastIndexAuthHeaders,
} from '../../server/utils/podcastSearch';

describe('normalizeItunesResult', () => {
  it('maps an iTunes podcast result to a ShowCandidate', () => {
    const result = normalizeItunesResult({
      collectionName: 'Planet Money',
      artistName: 'NPR',
      artworkUrl600: 'https://example.com/art.jpg',
      feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
    });
    expect(result).toEqual({
      title: 'Planet Money',
      author: 'NPR',
      description: '',
      artworkUrl: 'https://example.com/art.jpg',
      feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
    });
  });

  it('returns null when feedUrl is missing or empty', () => {
    expect(normalizeItunesResult({ collectionName: 'No Feed' })).toBeNull();
    expect(normalizeItunesResult({ collectionName: 'Empty Feed', feedUrl: '   ' })).toBeNull();
  });

  it('falls back to trackName when collectionName is missing, and empty author when artistName is missing', () => {
    const result = normalizeItunesResult({ trackName: 'Fallback Title', feedUrl: 'https://a.com/feed.xml' });
    expect(result?.title).toBe('Fallback Title');
    expect(result?.author).toBe('');
  });

  it('falls back to "Sans nom" when no title field is present at all', () => {
    const result = normalizeItunesResult({ feedUrl: 'https://a.com/feed.xml' });
    expect(result?.title).toBe('Sans nom');
  });

  it('falls back to artworkUrl100 when artworkUrl600 is missing', () => {
    const result = normalizeItunesResult({ feedUrl: 'https://a.com/feed.xml', artworkUrl100: 'https://a.com/small.jpg' });
    expect(result?.artworkUrl).toBe('https://a.com/small.jpg');
  });
});

describe('normalizePodcastIndexResult', () => {
  it('maps a PodcastIndex feed result to a ShowCandidate', () => {
    const result = normalizePodcastIndexResult({
      title: 'Planet Money',
      author: 'NPR',
      description: 'The economy explained.',
      image: 'https://example.com/art2.jpg',
      url: 'https://feeds.npr.org/510289/podcast.xml',
    });
    expect(result).toEqual({
      title: 'Planet Money',
      author: 'NPR',
      description: 'The economy explained.',
      artworkUrl: 'https://example.com/art2.jpg',
      feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
    });
  });

  it('returns null when url is missing or empty', () => {
    expect(normalizePodcastIndexResult({ title: 'No Feed' })).toBeNull();
    expect(normalizePodcastIndexResult({ title: 'Empty Feed', url: '  ' })).toBeNull();
  });

  it('falls back to the artwork field when image is missing, and empty author/description when missing', () => {
    const result = normalizePodcastIndexResult({ artwork: 'https://example.com/fallback.jpg', url: 'https://a.com/feed.xml' });
    expect(result?.artworkUrl).toBe('https://example.com/fallback.jpg');
    expect(result?.author).toBe('');
    expect(result?.description).toBe('');
  });

  it('falls back to "Sans nom" when no title field is present at all', () => {
    const result = normalizePodcastIndexResult({ url: 'https://a.com/feed.xml' });
    expect(result?.title).toBe('Sans nom');
  });
});

describe('mergeShowCandidates', () => {
  const itunesShow = {
    title: 'Planet Money (iTunes)',
    author: 'NPR',
    description: '',
    artworkUrl: 'https://itunes.example.com/art.jpg',
    feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
  };
  const podcastIndexDuplicate = {
    title: 'Planet Money (PodcastIndex)',
    author: 'NPR',
    description: 'The economy explained.',
    artworkUrl: 'https://podcastindex.example.com/art.jpg',
    feedUrl: 'https://feeds.npr.org/510289/podcast.xml/',
  };
  const podcastIndexUnique = {
    title: 'Indie Show',
    author: 'Someone',
    description: 'An indie podcast.',
    artworkUrl: 'https://podcastindex.example.com/indie.jpg',
    feedUrl: 'https://example.com/indie-feed.xml',
  };

  it('keeps the iTunes version when the same feed URL is on both sources', () => {
    const result = mergeShowCandidates([itunesShow], [podcastIndexDuplicate]);
    expect(result).toEqual([itunesShow]);
  });

  it('is case- and trailing-slash-insensitive when matching feed URLs', () => {
    const itunesUpper = { ...itunesShow, feedUrl: 'HTTPS://FEEDS.NPR.ORG/510289/PODCAST.XML' };
    const result = mergeShowCandidates([itunesUpper], [podcastIndexDuplicate]);
    expect(result).toEqual([itunesUpper]);
  });

  it('includes a PodcastIndex-only show not present in iTunes results', () => {
    const result = mergeShowCandidates([itunesShow], [podcastIndexUnique]);
    expect(result).toEqual([itunesShow, podcastIndexUnique]);
  });

  it('returns an empty array when both sources are empty', () => {
    expect(mergeShowCandidates([], [])).toEqual([]);
  });

  it('returns iTunes-only results unchanged when PodcastIndex has nothing', () => {
    expect(mergeShowCandidates([itunesShow], [])).toEqual([itunesShow]);
  });

  it('returns PodcastIndex-only results unchanged when iTunes has nothing', () => {
    expect(mergeShowCandidates([], [podcastIndexUnique])).toEqual([podcastIndexUnique]);
  });
});

describe('computePodcastIndexAuthHeaders', () => {
  it('computes the sha1(apiKey + apiSecret + timestamp) Authorization header', () => {
    const apiKey = 'MYKEY123';
    const apiSecret = 'MYSECRET456';
    const timestamp = 1700000000;
    const expectedHash = crypto.createHash('sha1').update(apiKey + apiSecret + timestamp).digest('hex');

    const headers = computePodcastIndexAuthHeaders(apiKey, apiSecret, timestamp);

    expect(headers).toEqual({
      'X-Auth-Date': String(timestamp),
      'X-Auth-Key': apiKey,
      'Authorization': expectedHash,
      'User-Agent': 'YouKeep/1.0',
    });
  });

  it('produces a different hash for a different timestamp', () => {
    const h1 = computePodcastIndexAuthHeaders('k', 's', 1700000000);
    const h2 = computePodcastIndexAuthHeaders('k', 's', 1700000001);
    expect(h1['Authorization']).not.toBe(h2['Authorization']);
  });

  it('produces a different hash for a different apiKey/apiSecret', () => {
    const h1 = computePodcastIndexAuthHeaders('k1', 's', 1700000000);
    const h2 = computePodcastIndexAuthHeaders('k2', 's', 1700000000);
    expect(h1['Authorization']).not.toBe(h2['Authorization']);
  });
});

describe('normalizeListenNotesResult', () => {
  it('maps a Listen Notes result to a ShowCandidate using the real search-result field names', () => {
    const result = normalizeListenNotesResult({
      title_original: 'Planet Money',
      publisher_original: 'NPR',
      description_original: 'The economy explained.',
      image: 'https://example.com/art3.jpg',
      rss: 'https://feeds.npr.org/510289/podcast.xml',
    });
    expect(result).toEqual({
      title: 'Planet Money',
      author: 'NPR',
      description: 'The economy explained.',
      artworkUrl: 'https://example.com/art3.jpg',
      feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
    });
  });

  it('falls back to the plain title/publisher/description fields when the _original variants are absent', () => {
    const result = normalizeListenNotesResult({
      title: 'Planet Money',
      publisher: 'NPR',
      description: 'The economy explained.',
      image: 'https://example.com/art3.jpg',
      rss: 'https://feeds.npr.org/510289/podcast.xml',
    });
    expect(result).toEqual({
      title: 'Planet Money',
      author: 'NPR',
      description: 'The economy explained.',
      artworkUrl: 'https://example.com/art3.jpg',
      feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
    });
  });

  it('returns null when rss is missing or empty', () => {
    expect(normalizeListenNotesResult({ title_original: 'No Feed' })).toBeNull();
    expect(normalizeListenNotesResult({ title_original: 'Empty Feed', rss: '   ' })).toBeNull();
  });

  it('falls back to empty author/description/artworkUrl when those fields are missing', () => {
    const result = normalizeListenNotesResult({ rss: 'https://a.com/feed.xml' });
    expect(result?.author).toBe('');
    expect(result?.description).toBe('');
    expect(result?.artworkUrl).toBe('');
  });

  it('falls back to "Sans nom" when title is missing', () => {
    const result = normalizeListenNotesResult({ rss: 'https://a.com/feed.xml' });
    expect(result?.title).toBe('Sans nom');
  });
});

describe('mergeShowCandidates with a 3rd Listen Notes source', () => {
  const itunesShow = {
    title: 'Planet Money (iTunes)',
    author: 'NPR',
    description: '',
    artworkUrl: 'https://itunes.example.com/art.jpg',
    feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
  };
  const podcastIndexShow = {
    title: 'Planet Money (PodcastIndex)',
    author: 'NPR',
    description: 'The economy explained.',
    artworkUrl: 'https://podcastindex.example.com/art.jpg',
    feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
  };
  const listenNotesShow = {
    title: 'Planet Money (Listen Notes)',
    author: 'NPR',
    description: 'The economy explained differently.',
    artworkUrl: 'https://listennotes.example.com/art.jpg',
    feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
  };
  const listenNotesUnique = {
    title: 'Obscure Indie Show',
    author: 'Someone Else',
    description: 'A very indie podcast.',
    artworkUrl: 'https://listennotes.example.com/indie.jpg',
    feedUrl: 'https://example.com/obscure-feed.xml',
  };

  it('keeps iTunes when the same feed URL is on all 3 sources', () => {
    const result = mergeShowCandidates([itunesShow], [podcastIndexShow], [listenNotesShow]);
    expect(result).toEqual([itunesShow]);
  });

  it('keeps PodcastIndex over Listen Notes when only those two share a feed URL', () => {
    const result = mergeShowCandidates([], [podcastIndexShow], [listenNotesShow]);
    expect(result).toEqual([podcastIndexShow]);
  });

  it('includes a Listen-Notes-only show not present in either other source', () => {
    const result = mergeShowCandidates([itunesShow], [], [listenNotesUnique]);
    expect(result).toEqual([itunesShow, listenNotesUnique]);
  });

  it('defaults the 3rd argument to an empty array when omitted (backward compatible with 2-source calls)', () => {
    const result = mergeShowCandidates([itunesShow], []);
    expect(result).toEqual([itunesShow]);
  });

  it('returns an empty array when all 3 sources are empty', () => {
    expect(mergeShowCandidates([], [], [])).toEqual([]);
  });
});
