import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeYoutubeDataApiChannel, extractYtInitialData, parseChannelSearchResults } from '../../server/utils/youtubeSearch';

describe('normalizeYoutubeDataApiChannel', () => {
  it('maps a YouTube Data API search result to a ChannelCandidate, preferring id.channelId', () => {
    expect(normalizeYoutubeDataApiChannel({
      id: { kind: 'youtube#channel', channelId: 'UCXXXXXX' },
      snippet: { channelId: 'UCOTHER', title: 'Stromae', description: 'Official channel', thumbnails: { default: { url: 'https://example.com/thumb.jpg' } } },
    })).toEqual({
      id: 'UCXXXXXX', title: 'Stromae', description: 'Official channel', avatarUrl: 'https://example.com/thumb.jpg',
      subscriberCount: '', videoCount: '', handle: '',
    });
  });

  it('falls back to snippet.channelId, and to "Sans nom"/empty strings for missing fields', () => {
    expect(normalizeYoutubeDataApiChannel({ snippet: { channelId: 'UCYYYYYY', title: 'Fallback Channel' } })?.id).toBe('UCYYYYYY');
    expect(normalizeYoutubeDataApiChannel({ id: { channelId: 'UCZZZZZZ' } })).toMatchObject({ title: 'Sans nom', description: '', avatarUrl: '' });
  });

  it('returns null when neither id.channelId nor snippet.channelId is present', () => {
    expect(normalizeYoutubeDataApiChannel({ snippet: { title: 'No ID' } })).toBeNull();
    expect(normalizeYoutubeDataApiChannel({})).toBeNull();
  });
});

describe('extractYtInitialData', () => {
  const fixture = readFileSync(fileURLToPath(new URL('../fixtures/youtube-channel-search.html', import.meta.url)), 'utf8');

  // The previous extraction, kept here to prove the new parser gives the same output.
  const legacyExtract = (html: string) => {
    const match = html.match(/var ytInitialData = ({.*?});/s) || html.match(/window\["ytInitialData"\] = ({.*?});/s);
    return match?.[1] ? JSON.parse(match[1]) : null;
  };

  it('returns exactly what the old regex returned on a saved results page', () => {
    const data = extractYtInitialData(fixture);
    expect(data).not.toBeNull();
    expect(data).toEqual(legacyExtract(fixture));
    expect(parseChannelSearchResults(data)).toEqual([
      {
        id: 'UCabcdefghijklmnopqrstuv', title: 'Daft Punk', description: 'Official channel of Daft Punk.',
        avatarUrl: 'https://yt3.ggpht.com/daft=s176', subscriberCount: '@daftpunk', videoCount: '9.6M subscribers', handle: '/@daftpunk',
      },
      {
        id: 'UCzyxwvutsrqponmlkjihgfe', title: 'Daft Punk - Topic', description: 'Music "quoted" and \\ escaped',
        avatarUrl: 'https://yt3.ggpht.com/topic=s176', subscriberCount: '', videoCount: '1.2M subscribers', handle: '',
      },
    ]);
  });

  it('reads the window["ytInitialData"] form too', () => {
    expect(extractYtInitialData('<script>window["ytInitialData"] = {"a":{"b":[1,2]}};</script>')).toEqual({ a: { b: [1, 2] } });
  });

  it('is not fooled by braces, quotes or "};" inside strings', () => {
    const html = '<script>var ytInitialData = {"t":"a};b{c\\"}","n":{"x":"\\\\"}};var next = {"z":1};</script>';
    expect(extractYtInitialData(html)).toEqual({ t: 'a};b{c"}', n: { x: '\\' } });
  });

  it('returns null when the data is missing, unterminated or invalid', () => {
    expect(extractYtInitialData('<html>no data</html>')).toBeNull();
    expect(extractYtInitialData('var ytInitialData = {"a":{"b":1}')).toBeNull();
    expect(extractYtInitialData('var ytInitialData = {a:1};')).toBeNull();
    expect(parseChannelSearchResults(null)).toEqual([]);
  });
});
