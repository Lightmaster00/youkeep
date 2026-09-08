import crypto from 'crypto';

export interface ShowCandidate {
  title: string;
  author: string;
  description: string;
  artworkUrl: string;
  feedUrl: string;
}

export function normalizeItunesResult(raw: any): ShowCandidate | null {
  const feedUrl = typeof raw?.feedUrl === 'string' ? raw.feedUrl.trim() : '';
  if (!feedUrl) return null;

  return {
    title: raw.collectionName || raw.trackName || 'Sans nom',
    author: raw.artistName || '',
    description: '',
    artworkUrl: raw.artworkUrl600 || raw.artworkUrl100 || '',
    feedUrl,
  };
}

export function normalizePodcastIndexResult(raw: any): ShowCandidate | null {
  const feedUrl = typeof raw?.url === 'string' ? raw.url.trim() : '';
  if (!feedUrl) return null;

  return {
    title: raw.title || 'Sans nom',
    author: raw.author || '',
    description: raw.description || '',
    artworkUrl: raw.image || raw.artwork || '',
    feedUrl,
  };
}

export function normalizeListenNotesResult(raw: any): ShowCandidate | null {
  const feedUrl = typeof raw?.rss === 'string' ? raw.rss.trim() : '';
  if (!feedUrl) return null;

  return {
    title: raw.title || 'Sans nom',
    author: raw.publisher || '',
    description: raw.description || '',
    artworkUrl: raw.image || '',
    feedUrl,
  };
}

function normalizeFeedUrlKey(feedUrl: string): string {
  return feedUrl.trim().toLowerCase().replace(/\/+$/, '');
}

export function mergeShowCandidates(
  itunesResults: ShowCandidate[],
  podcastIndexResults: ShowCandidate[],
  listenNotesResults: ShowCandidate[] = []
): ShowCandidate[] {
  const merged = new Map<string, ShowCandidate>();

  for (const candidate of itunesResults) {
    merged.set(normalizeFeedUrlKey(candidate.feedUrl), candidate);
  }
  for (const candidate of podcastIndexResults) {
    const key = normalizeFeedUrlKey(candidate.feedUrl);
    if (!merged.has(key)) {
      merged.set(key, candidate);
    }
  }
  for (const candidate of listenNotesResults) {
    const key = normalizeFeedUrlKey(candidate.feedUrl);
    if (!merged.has(key)) {
      merged.set(key, candidate);
    }
  }

  return Array.from(merged.values());
}

export function computePodcastIndexAuthHeaders(apiKey: string, apiSecret: string, unixTimestamp: number): Record<string, string> {
  const hash = crypto.createHash('sha1').update(apiKey + apiSecret + unixTimestamp).digest('hex');
  return {
    'X-Auth-Date': String(unixTimestamp),
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'YouKeep/1.0',
  };
}
