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
