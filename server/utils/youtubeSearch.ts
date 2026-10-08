export interface ChannelCandidate {
  id: string;
  title: string;
  description: string;
  avatarUrl: string;
  subscriberCount: string;
  videoCount: string;
  handle: string;
}

export function normalizeYoutubeDataApiChannel(raw: any): ChannelCandidate | null {
  const id = raw?.id?.channelId || raw?.snippet?.channelId || '';
  if (!id) return null;

  return {
    id,
    title: raw.snippet?.title || 'Sans nom',
    description: raw.snippet?.description || '',
    avatarUrl: raw.snippet?.thumbnails?.default?.url || '',
    subscriberCount: '',
    videoCount: '',
    handle: '',
  };
}

/** Longest ytInitialData object scanned for (the whole results page is about 1 MB). */
const MAX_INITIAL_DATA_LENGTH = 5_000_000;

/**
 * Finds the JSON object assigned to ytInitialData in a YouTube results page
 * by matching braces (strings and escapes aware) from its first "{", instead
 * of a lazy regex over the whole page. Returns null when it is missing,
 * unterminated within MAX_INITIAL_DATA_LENGTH, or not valid JSON.
 */
export function extractYtInitialData(html: string): any | null {
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = '];
  for (const marker of markers) {
    const at = html.indexOf(marker);
    if (at === -1) continue;
    const start = at + marker.length;
    if (html[start] !== '{') continue;
    const limit = Math.min(html.length, start + MAX_INITIAL_DATA_LENGTH);
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < limit; i++) {
      const ch = html.charCodeAt(i);
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === 92 /* \ */) escaped = true;
        else if (ch === 34 /* " */) inString = false;
        continue;
      }
      if (ch === 34) inString = true;
      else if (ch === 123 /* { */) depth++;
      else if (ch === 125 /* } */) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
  return null;
}

/** The channel results of a parsed ytInitialData search page. */
export function parseChannelSearchResults(data: any): ChannelCandidate[] {
  const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
  if (!contents || !Array.isArray(contents)) return [];

  const channels: ChannelCandidate[] = [];
  for (const item of contents) {
    if (!item.channelRenderer) continue;
    const cr = item.channelRenderer;
    let avatarUrl = cr.thumbnail?.thumbnails?.[cr.thumbnail.thumbnails.length - 1]?.url || cr.thumbnail?.thumbnails?.[0]?.url;
    if (avatarUrl && avatarUrl.startsWith('//')) {
      avatarUrl = 'https:' + avatarUrl;
    }
    channels.push({
      id: cr.channelId,
      title: cr.title?.simpleText || cr.title?.runs?.[0]?.text || 'Sans nom',
      description: cr.descriptionSnippet?.runs?.[0]?.text || '',
      avatarUrl,
      subscriberCount: cr.subscriberCountText?.simpleText || cr.subscriberCountText?.runs?.[0]?.text || '',
      videoCount: cr.videoCountText?.simpleText || cr.videoCountText?.runs?.[0]?.text || '',
      handle: cr.canonicalBaseUrl || ''
    });
  }
  return channels;
}
