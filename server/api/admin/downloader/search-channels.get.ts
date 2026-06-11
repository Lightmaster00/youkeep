import { defineEventHandler, getQuery, createError } from 'h3';

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

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D`;

  try {
    const response = await globalThis.$fetch<string>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    const match = response.match(/var ytInitialData = ({.*?});/s) || response.match(/window\["ytInitialData"\] = ({.*?});/s);
    if (!match || !match[1]) {
      return { channels: [] };
    }

    const data = JSON.parse(match[1]);
    const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
    if (!contents || !Array.isArray(contents)) {
      return { channels: [] };
    }

    const channels: any[] = [];
    for (const item of contents) {
      if (item.channelRenderer) {
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
    }

    return { channels };
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err.message || 'Failed to search YouTube channels.'
    });
  }
});
