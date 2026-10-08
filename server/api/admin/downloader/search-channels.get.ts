import { defineEventHandler, getQuery, createError } from 'h3';
import { normalizeYoutubeDataApiChannel, extractYtInitialData, parseChannelSearchResults, type ChannelCandidate } from '../../../utils/youtubeSearch';
import { cachedSearch, isSearchTimeout, SEARCH_TIMEOUT_MS, SEARCH_TIMEOUT_MESSAGE } from '../../../utils/searchCache';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const query = getQuery(event);
  const q = query.q ? String(query.q).trim() : '';

  if (!q) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Search query is required.'
    });
  }

  const db = getDb();
  const platformRow = db.prepare("SELECT api_key FROM search_platforms WHERE id = 'youtube_data_api'").get() as { api_key: string } | undefined;
  const youtubeApiKey = platformRow?.api_key || '';

  if (youtubeApiKey) {
    try {
      const channels = await cachedSearch<ChannelCandidate>('youtube-api', q, async () => {
        const data = await globalThis.$fetch<any>('https://www.googleapis.com/youtube/v3/search', {
          params: { part: 'snippet', type: 'channel', q, key: youtubeApiKey, maxResults: 25 },
          parseResponse: JSON.parse,
          timeout: SEARCH_TIMEOUT_MS,
        });
        const items = Array.isArray(data?.items) ? data.items : [];
        return items
          .map(normalizeYoutubeDataApiChannel)
          .filter((c: any): c is ChannelCandidate => c !== null);
      });
      return { channels };
    } catch (err: any) {
      console.error('[admin/downloader/search-channels] YouTube Data API failed, falling back to scraping:', err?.statusCode || err?.status || 'unknown status', err?.statusMessage || err?.message || '');
    }
  }

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D`;

  try {
    const channels = await cachedSearch<ChannelCandidate>('youtube-scrape', q, async () => {
      const response = await globalThis.$fetch<string>(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: SEARCH_TIMEOUT_MS,
      });
      return parseChannelSearchResults(extractYtInitialData(String(response)));
    });
    return { channels };
  } catch (err: any) {
    if (isSearchTimeout(err)) {
      throw createError({ statusCode: 504, statusMessage: SEARCH_TIMEOUT_MESSAGE });
    }
    console.error('[admin/downloader/search-channels]', err);
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to search YouTube channels. Check the server logs for details.'
    });
  }
});
