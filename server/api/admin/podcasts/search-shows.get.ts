import { defineEventHandler, getQuery, createError } from 'h3';
import {
  normalizeItunesResult,
  normalizePodcastIndexResult,
  mergeShowCandidates,
  computePodcastIndexAuthHeaders,
} from '../../../utils/podcastSearch';

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

  try {
    const db = getDb();
    const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_key'").get() as { value: string } | undefined;
    const secretRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_secret'").get() as { value: string } | undefined;
    const apiKey = keyRow?.value || '';
    const apiSecret = secretRow?.value || '';

    const fetchItunes = async (): Promise<any[]> => {
      const data = await globalThis.$fetch<any>('https://itunes.apple.com/search', {
        params: { media: 'podcast', term: q, limit: 25 }
      });
      return Array.isArray(data?.results) ? data.results : [];
    };

    const fetchPodcastIndex = async (): Promise<any[]> => {
      if (!apiKey || !apiSecret) return [];
      const unixTimestamp = Math.floor(Date.now() / 1000);
      const headers = computePodcastIndexAuthHeaders(apiKey, apiSecret, unixTimestamp);
      const data = await globalThis.$fetch<any>('https://api.podcastindex.org/api/1.0/search/byterm', {
        params: { q },
        headers
      });
      return Array.isArray(data?.feeds) ? data.feeds : [];
    };

    const [itunesResult, podcastIndexResult] = await Promise.allSettled([fetchItunes(), fetchPodcastIndex()]);

    if (itunesResult.status === 'rejected') {
      console.error('[admin/podcasts/search-shows] iTunes fetch failed', itunesResult.reason);
    }
    if (podcastIndexResult.status === 'rejected') {
      console.error('[admin/podcasts/search-shows] PodcastIndex fetch failed', podcastIndexResult.reason);
    }

    const itunesRaw = itunesResult.status === 'fulfilled' ? itunesResult.value : [];
    const podcastIndexRaw = podcastIndexResult.status === 'fulfilled' ? podcastIndexResult.value : [];

    const itunesCandidates = itunesRaw
      .map(normalizeItunesResult)
      .filter((c: any): c is NonNullable<typeof c> => c !== null);
    const podcastIndexCandidates = podcastIndexRaw
      .map(normalizePodcastIndexResult)
      .filter((c: any): c is NonNullable<typeof c> => c !== null);

    return { shows: mergeShowCandidates(itunesCandidates, podcastIndexCandidates) };
  } catch (err) {
    console.error('[admin/podcasts/search-shows]', err);
    return { shows: [] };
  }
});
