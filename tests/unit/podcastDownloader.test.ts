import { describe, it, expect } from 'vitest';
import { parseItunesDuration, hashPodcastEpisodeId, stripHtmlToPlainText } from '../../server/utils/podcastDownloader';

describe('parseItunesDuration', () => {
  it.each([
    ['01:02:03', 3723], ['1:2:3', 3723], ['05:30', 330], ['125', 125], ['0', 0],
    [undefined, null], [null, null], ['', null], ['   ', null], ['abc', null], ['aa:bb', null], ['1:2:3:4', null], [':30', null],
  ])('%j → %j', (raw, expected) => {
    expect(parseItunesDuration(raw as any)).toBe(expected);
  });
});

describe('hashPodcastEpisodeId', () => {
  it('is a deterministic sha256 hex digest scoped by feed URL and guid', () => {
    const id = hashPodcastEpisodeId('https://example.com/feed.xml', 'ep-1');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPodcastEpisodeId('https://example.com/feed.xml', 'ep-1')).toBe(id);
    expect(hashPodcastEpisodeId('https://other.example.com/feed.xml', 'ep-1')).not.toBe(id);
    expect(hashPodcastEpisodeId('https://example.com/feed.xml', 'ep-2')).not.toBe(id);
  });
});

describe('stripHtmlToPlainText', () => {
  it('strips <em>/<br>/<a href> tags from a real feed-shaped description (NPR Planet Money)', () => {
    const raw = "Wanna see a trick? Give us any topic and we can tie it back to the economy. At <em>Planet Money</em>, we explore the forces that shape our lives and bring you along for the ride. Don't just understand the economy – understand the world.<br><br><em> Support public media by joining NPR+ at </em><a href=\"http://plus.npr.org/\"target=\"_blank\"><em>plus.npr.org</em></a><em>. You'll get perks for over 25 NPR podcasts, including bonus episodes and sponsor-free listening for Planet Money.</em>";
    const result = stripHtmlToPlainText(raw);
    expect(result).not.toBeNull();
    expect(result).not.toMatch(/[<>]/);
    expect(result).toContain('At Planet Money, we explore');
    expect(result).toContain('Support public media by joining NPR+ at plus.npr.org');
    // The <br><br> boundary must not glue adjacent words together.
    expect(result).not.toMatch(/world\.Support/);
  });

  it('decodes common HTML entities', () => {
    expect(stripHtmlToPlainText('Rock &amp; Roll &lt;live&gt; &quot;show&quot; &#39;tonight&#39;&nbsp;now'))
      .toBe('Rock & Roll <live> "show" \'tonight\' now');
  });

  it('returns null for null/undefined/blank input and for tags with no visible text', () => {
    expect(stripHtmlToPlainText(null)).toBeNull();
    expect(stripHtmlToPlainText(undefined)).toBeNull();
    expect(stripHtmlToPlainText('   ')).toBeNull();
    expect(stripHtmlToPlainText('<br><br>')).toBeNull();
  });

  it('collapses excess whitespace left behind by removed tags', () => {
    expect(stripHtmlToPlainText('<p>Hello</p>   <p>World</p>\n\n  <div>!</div>')).toBe('Hello World !');
  });
});
