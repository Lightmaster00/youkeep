import { describe, it, expect } from 'vitest';
import { normalizeYoutubeDataApiChannel } from '../../server/utils/youtubeSearch';

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
