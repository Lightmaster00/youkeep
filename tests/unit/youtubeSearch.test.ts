import { describe, it, expect } from 'vitest';
import { normalizeYoutubeDataApiChannel } from '../../server/utils/youtubeSearch';

describe('normalizeYoutubeDataApiChannel', () => {
  it('maps a YouTube Data API search result to a ChannelCandidate, preferring id.channelId', () => {
    const result = normalizeYoutubeDataApiChannel({
      id: { kind: 'youtube#channel', channelId: 'UCXXXXXX' },
      snippet: {
        channelId: 'UCXXXXXX',
        title: 'Stromae',
        description: 'Official channel',
        thumbnails: { default: { url: 'https://example.com/thumb.jpg' } }
      }
    });
    expect(result).toEqual({
      id: 'UCXXXXXX',
      title: 'Stromae',
      description: 'Official channel',
      avatarUrl: 'https://example.com/thumb.jpg',
      subscriberCount: '',
      videoCount: '',
      handle: ''
    });
  });

  it('falls back to snippet.channelId when id.channelId is missing', () => {
    const result = normalizeYoutubeDataApiChannel({
      snippet: { channelId: 'UCYYYYYY', title: 'Fallback Channel' }
    });
    expect(result?.id).toBe('UCYYYYYY');
  });

  it('returns null when neither id.channelId nor snippet.channelId is present', () => {
    expect(normalizeYoutubeDataApiChannel({ snippet: { title: 'No ID' } })).toBeNull();
    expect(normalizeYoutubeDataApiChannel({})).toBeNull();
  });

  it('falls back to "Sans nom" for a missing title, and empty strings for description/avatarUrl when missing', () => {
    const result = normalizeYoutubeDataApiChannel({ id: { channelId: 'UCZZZZZZ' } });
    expect(result?.title).toBe('Sans nom');
    expect(result?.description).toBe('');
    expect(result?.avatarUrl).toBe('');
  });

  it('always returns empty strings for subscriberCount/videoCount/handle (not provided by this API endpoint)', () => {
    const result = normalizeYoutubeDataApiChannel({ id: { channelId: 'UCAAAAAA' }, snippet: { title: 'X' } });
    expect(result?.subscriberCount).toBe('');
    expect(result?.videoCount).toBe('');
    expect(result?.handle).toBe('');
  });
});
