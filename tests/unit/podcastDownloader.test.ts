import { describe, it, expect } from 'vitest';
import { parseItunesDuration, hashPodcastEpisodeId } from '../../server/utils/podcastDownloader';

describe('parseItunesDuration', () => {
  it('parses HH:MM:SS', () => {
    expect(parseItunesDuration('01:02:03')).toBe(3723);
  });

  it('parses MM:SS', () => {
    expect(parseItunesDuration('05:30')).toBe(330);
  });

  it('parses a bare integer number of seconds', () => {
    expect(parseItunesDuration('125')).toBe(125);
  });

  it('parses "0" as zero, not null', () => {
    expect(parseItunesDuration('0')).toBe(0);
  });

  it('returns null for missing input', () => {
    expect(parseItunesDuration(undefined)).toBeNull();
    expect(parseItunesDuration(null)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseItunesDuration('')).toBeNull();
    expect(parseItunesDuration('   ')).toBeNull();
  });

  it('returns null for non-numeric junk', () => {
    expect(parseItunesDuration('abc')).toBeNull();
    expect(parseItunesDuration('aa:bb')).toBeNull();
  });

  it('returns null for a malformed segment count', () => {
    expect(parseItunesDuration('1:2:3:4')).toBeNull();
    expect(parseItunesDuration(':30')).toBeNull();
  });

  it('tolerates unpadded single-digit segments', () => {
    expect(parseItunesDuration('1:2:3')).toBe(3723);
  });
});

describe('hashPodcastEpisodeId', () => {
  it('produces the same hash for the same feed URL and guid every time (deterministic)', () => {
    const id1 = hashPodcastEpisodeId('https://example.com/feed.xml', 'episode-42');
    const id2 = hashPodcastEpisodeId('https://example.com/feed.xml', 'episode-42');
    expect(id1).toBe(id2);
  });

  it('produces a different hash for different feeds reusing the same raw guid', () => {
    const idA = hashPodcastEpisodeId('https://feed-a.example.com/rss.xml', 'ep-1');
    const idB = hashPodcastEpisodeId('https://feed-b.example.com/rss.xml', 'ep-1');
    expect(idA).not.toBe(idB);
  });

  it('produces a different hash for a different guid within the same feed', () => {
    const idA = hashPodcastEpisodeId('https://example.com/feed.xml', 'ep-1');
    const idB = hashPodcastEpisodeId('https://example.com/feed.xml', 'ep-2');
    expect(idA).not.toBe(idB);
  });

  it('produces a stable id computed the same way ingestPodcastFeed falls back from a missing guid to the audio_url', () => {
    const feedUrl = 'https://example.com/feed.xml';
    const itemWithoutGuid = { guid: undefined as string | undefined, audioUrl: 'https://cdn.example.com/ep1.mp3' };
    // ingestPodcastFeed computes: item.guid || item.enclosure.url
    const rawGuid = itemWithoutGuid.guid || itemWithoutGuid.audioUrl;
    const idFromFallback = hashPodcastEpisodeId(feedUrl, rawGuid);
    const idFromDirectAudioUrl = hashPodcastEpisodeId(feedUrl, itemWithoutGuid.audioUrl);
    expect(idFromFallback).toBe(idFromDirectAudioUrl);
  });

  it('returns a 64-character lowercase hex sha256 digest', () => {
    const id = hashPodcastEpisodeId('https://example.com/feed.xml', 'ep-1');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});
