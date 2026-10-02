import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSearchSuggestions } from '../../app/composables/useSearchSuggestions';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

describe('useSearchSuggestions', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('normalizes video results with type "video"', async () => {
    fetchMock.mockResolvedValueOnce({
      videos: [{ id: '1', title: 'My Video', channel_title: 'My Channel' }],
    });
    const { suggestions, fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'per_space', 'video');
    await vi.waitFor(() => expect(suggestions.value).toHaveLength(1));
    expect(suggestions.value[0]).toEqual({ type: 'video', title: 'My Video', subtitle: 'My Channel' });
  });

  it('normalizes track results with type "track"', async () => {
    fetchMock.mockResolvedValueOnce({
      tracks: [{ id: '1', title: 'My Track', artist_name: 'My Artist' }],
    });
    const { suggestions, fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'per_space', 'music');
    await vi.waitFor(() => expect(suggestions.value).toHaveLength(1));
    expect(suggestions.value[0]).toEqual({ type: 'track', title: 'My Track', subtitle: 'My Artist' });
  });

  it('normalizes episode results with type "episode"', async () => {
    fetchMock.mockResolvedValueOnce({
      episodes: [{ id: '1', title: 'My Episode', show_title: 'My Show' }],
    });
    const { suggestions, fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'per_space', 'podcasts');
    await vi.waitFor(() => expect(suggestions.value).toHaveLength(1));
    expect(suggestions.value[0]).toEqual({ type: 'episode', title: 'My Episode', subtitle: 'My Show' });
  });

  it('in per_space mode, calls only the active space endpoint with limit=5', async () => {
    fetchMock.mockResolvedValueOnce({ tracks: [] });
    const { fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'per_space', 'music');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/music/tracks/search', { params: { q: 'foo', limit: 5 } });
  });

  it('in global mode, calls all 3 endpoints in parallel with limit=3 each', async () => {
    fetchMock.mockResolvedValue({ videos: [], tracks: [], episodes: [] });
    const { fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'global', 'video');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenCalledWith('/api/videos', { params: { q: 'foo', limit: 3 } });
    expect(fetchMock).toHaveBeenCalledWith('/api/music/tracks/search', { params: { q: 'foo', limit: 3 } });
    expect(fetchMock).toHaveBeenCalledWith('/api/podcasts/episodes/search', { params: { q: 'foo', limit: 3 } });
  });

  it('clears suggestions and does not fetch when the term is under 2 characters', async () => {
    const { suggestions, fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('a', 'per_space', 'video');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(suggestions.value).toEqual([]);
  });

  it('leaves suggestions empty (no throw) when a fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    const { suggestions, fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'per_space', 'video');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(suggestions.value).toEqual([]);
  });

  it('in global mode, skips disabled modules and only calls the enabled endpoints', async () => {
    fetchMock.mockResolvedValue({ videos: [], tracks: [], episodes: [] });
    const { fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'global', 'video', ['video', 'podcasts']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith('/api/videos', { params: { q: 'foo', limit: 3 } });
    expect(fetchMock).toHaveBeenCalledWith('/api/podcasts/episodes/search', { params: { q: 'foo', limit: 3 } });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/music/tracks/search', expect.anything());
  });

  it('in global mode with the default enabled list, still calls all three endpoints', async () => {
    fetchMock.mockResolvedValue({ videos: [], tracks: [], episodes: [] });
    const { fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'global', 'video');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
