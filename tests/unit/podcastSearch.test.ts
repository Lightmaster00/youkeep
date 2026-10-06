import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  normalizeItunesResult,
  normalizePodcastIndexResult,
  normalizeListenNotesResult,
  mergeShowCandidates,
  computePodcastIndexAuthHeaders,
} from '../../server/utils/podcastSearch';

const FEED = 'https://feeds.npr.org/510289/podcast.xml';
const EMPTY = { title: 'Sans nom', author: '', description: '', artworkUrl: '', feedUrl: 'https://a.com/feed.xml' };

describe('normalizeItunesResult', () => {
  it('maps an iTunes podcast result to a ShowCandidate', () => {
    expect(normalizeItunesResult({
      collectionName: 'Planet Money', artistName: 'NPR', artworkUrl600: 'https://example.com/art.jpg', feedUrl: FEED,
    })).toEqual({ title: 'Planet Money', author: 'NPR', description: '', artworkUrl: 'https://example.com/art.jpg', feedUrl: FEED });
  });

  it('returns null when feedUrl is missing or blank', () => {
    expect(normalizeItunesResult({ collectionName: 'No Feed' })).toBeNull();
    expect(normalizeItunesResult({ collectionName: 'Empty Feed', feedUrl: '   ' })).toBeNull();
  });

  it('falls back trackName → "Sans nom" and artworkUrl600 → artworkUrl100 → empty', () => {
    expect(normalizeItunesResult({ trackName: 'Fallback Title', artworkUrl100: 'small.jpg', feedUrl: FEED }))
      .toMatchObject({ title: 'Fallback Title', author: '', artworkUrl: 'small.jpg' });
    expect(normalizeItunesResult({ feedUrl: 'https://a.com/feed.xml' })).toEqual(EMPTY);
  });
});

describe('normalizePodcastIndexResult', () => {
  it('maps a PodcastIndex feed result to a ShowCandidate', () => {
    expect(normalizePodcastIndexResult({
      title: 'Planet Money', author: 'NPR', description: 'The economy explained.', image: 'https://example.com/art2.jpg', url: FEED,
    })).toEqual({ title: 'Planet Money', author: 'NPR', description: 'The economy explained.', artworkUrl: 'https://example.com/art2.jpg', feedUrl: FEED });
  });

  it('returns null when url is missing or blank', () => {
    expect(normalizePodcastIndexResult({ title: 'No Feed' })).toBeNull();
    expect(normalizePodcastIndexResult({ title: 'Empty Feed', url: '  ' })).toBeNull();
  });

  it('falls back image → artwork and to empty/"Sans nom" for missing fields', () => {
    expect(normalizePodcastIndexResult({ artwork: 'fallback.jpg', url: FEED })?.artworkUrl).toBe('fallback.jpg');
    expect(normalizePodcastIndexResult({ url: 'https://a.com/feed.xml' })).toEqual(EMPTY);
  });
});

describe('normalizeListenNotesResult', () => {
  const expected = { title: 'Planet Money', author: 'NPR', description: 'The economy explained.', artworkUrl: 'art3.jpg', feedUrl: FEED };

  it('maps a Listen Notes result using the real search-result field names (_original), then the plain ones', () => {
    expect(normalizeListenNotesResult({
      title_original: 'Planet Money', publisher_original: 'NPR', description_original: 'The economy explained.', image: 'art3.jpg', rss: FEED,
    })).toEqual(expected);
    expect(normalizeListenNotesResult({
      title: 'Planet Money', publisher: 'NPR', description: 'The economy explained.', image: 'art3.jpg', rss: FEED,
    })).toEqual(expected);
  });

  it('returns null when rss is missing or blank, and falls back to empty/"Sans nom" otherwise', () => {
    expect(normalizeListenNotesResult({ title_original: 'No Feed' })).toBeNull();
    expect(normalizeListenNotesResult({ title_original: 'Empty Feed', rss: '   ' })).toBeNull();
    expect(normalizeListenNotesResult({ rss: 'https://a.com/feed.xml' })).toEqual(EMPTY);
  });
});

describe('mergeShowCandidates', () => {
  const show = (title: string, feedUrl = FEED) => ({ title, author: 'NPR', description: '', artworkUrl: '', feedUrl });
  const itunes = show('iTunes');
  const podcastIndex = show('PodcastIndex', 'HTTPS://FEEDS.NPR.ORG/510289/PODCAST.XML/');
  const listenNotes = show('Listen Notes');
  const indie = show('Indie', 'https://example.com/indie-feed.xml');
  const obscure = show('Obscure', 'https://example.com/obscure-feed.xml');

  it('dedupes by case- and trailing-slash-insensitive feed URL with priority iTunes > PodcastIndex > Listen Notes', () => {
    expect(mergeShowCandidates([itunes], [podcastIndex], [listenNotes])).toEqual([itunes]);
    expect(mergeShowCandidates([], [podcastIndex], [listenNotes])).toEqual([podcastIndex]);
  });

  it('appends shows unique to the lower-priority sources, in source order', () => {
    expect(mergeShowCandidates([itunes], [indie], [obscure])).toEqual([itunes, indie, obscure]);
    expect(mergeShowCandidates([], [indie])).toEqual([indie]);
    expect(mergeShowCandidates([], [], [])).toEqual([]);
  });
});

describe('computePodcastIndexAuthHeaders', () => {
  it('computes the sha1(apiKey + apiSecret + timestamp) Authorization header', () => {
    const expectedHash = crypto.createHash('sha1').update('MYKEY123' + 'MYSECRET456' + 1700000000).digest('hex');
    expect(computePodcastIndexAuthHeaders('MYKEY123', 'MYSECRET456', 1700000000)).toEqual({
      'X-Auth-Date': '1700000000',
      'X-Auth-Key': 'MYKEY123',
      'Authorization': expectedHash,
      'User-Agent': 'YouKeep/1.0',
    });
  });
});
