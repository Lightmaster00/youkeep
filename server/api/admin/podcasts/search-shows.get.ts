import { defineEventHandler, getQuery, createError } from 'h3';
import {
  normalizeItunesResult,
  normalizePodcastIndexResult,
  normalizeListenNotesResult,
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
    const platformRows = db.prepare("SELECT id, api_key, api_secret FROM search_platforms WHERE id IN ('podcastindex', 'listennotes')").all() as { id: string; api_key: string; api_secret: string }[];
    const podcastIndexRow = platformRows.find((p) => p.id === 'podcastindex');
    const listenNotesRow = platformRows.find((p) => p.id === 'listennotes');
    const podcastIndexApiKey = podcastIndexRow?.api_key || '';
    const podcastIndexApiSecret = podcastIndexRow?.api_secret || '';
    const listenNotesApiKey = listenNotesRow?.api_key || '';

    const fetchItunes = async (): Promise<any[]> => {
      const data = await globalThis.$fetch<any>('https://itunes.apple.com/search', {
        params: { media: 'podcast', term: q, limit: 25 },
        parseResponse: JSON.parse,
        timeout: 8000,
      });
      return Array.isArray(data?.results) ? data.results : [];
    };

    const fetchPodcastIndex = async (): Promise<any[]> => {
      if (!podcastIndexApiKey || !podcastIndexApiSecret) return [];
      const unixTimestamp = Math.floor(Date.now() / 1000);
      const headers = computePodcastIndexAuthHeaders(podcastIndexApiKey, podcastIndexApiSecret, unixTimestamp);
      const data = await globalThis.$fetch<any>('https://api.podcastindex.org/api/1.0/search/byterm', {
        params: { q },
        headers,
        timeout: 8000,
      });
      return Array.isArray(data?.feeds) ? data.feeds : [];
    };

    const fetchListenNotes = async (): Promise<any[]> => {
      if (!listenNotesApiKey) return [];
      const data = await globalThis.$fetch<any>('https://listen-api.listennotes.com/api/v2/search', {
        params: { type: 'podcast', q },
        headers: { 'X-ListenAPI-Key': listenNotesApiKey },
        timeout: 8000,
      });
      return Array.isArray(data?.results) ? data.results : [];
    };

    const [itunesResult, podcastIndexResult, listenNotesResult] = await Promise.allSettled([
      fetchItunes(),
      fetchPodcastIndex(),
      fetchListenNotes(),
    ]);

    if (itunesResult.status === 'rejected') {
      console.error('[admin/podcasts/search-shows] iTunes fetch failed', itunesResult.reason);
    }
    if (podcastIndexResult.status === 'rejected') {
      console.error('[admin/podcasts/search-shows] PodcastIndex fetch failed', podcastIndexResult.reason);
    }
    if (listenNotesResult.status === 'rejected') {
      console.error('[admin/podcasts/search-shows] Listen Notes fetch failed', listenNotesResult.reason);
    }

    const itunesRaw = itunesResult.status === 'fulfilled' ? itunesResult.value : [];
    const podcastIndexRaw = podcastIndexResult.status === 'fulfilled' ? podcastIndexResult.value : [];
    const listenNotesRaw = listenNotesResult.status === 'fulfilled' ? listenNotesResult.value : [];

    const itunesCandidates = itunesRaw
      .map(normalizeItunesResult)
      .filter((c: any): c is NonNullable<typeof c> => c !== null);
    const podcastIndexCandidates = podcastIndexRaw
      .map(normalizePodcastIndexResult)
      .filter((c: any): c is NonNullable<typeof c> => c !== null);
    const listenNotesCandidates = listenNotesRaw
      .map(normalizeListenNotesResult)
      .filter((c: any): c is NonNullable<typeof c> => c !== null);

    return { shows: mergeShowCandidates(itunesCandidates, podcastIndexCandidates, listenNotesCandidates) };
  } catch (err) {
    console.error('[admin/podcasts/search-shows]', err);
    return { shows: [] };
  }
});
