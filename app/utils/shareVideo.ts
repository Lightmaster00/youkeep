import { apiErrorMessage } from '~/utils/apiError';
import { copyToClipboard } from '~/utils/clipboard';

// Who may share a video, and with which link (R10): an admin gets the share
// link from the server (with its token when the video is private), anyone
// else only a public video of a public channel, whose plain /watch link works
// for every visitor. Otherwise there is no Share button.

export function canShareVideo(video: object | null | undefined, isAdmin: boolean): boolean {
  if (!video) return false;
  const flag = (video as { publicly_shareable?: number | boolean | null }).publicly_shareable;
  return isAdmin || flag === 1 || flag === true;
}

export async function videoShareUrl(video: { id: string }, isAdmin: boolean): Promise<string> {
  const origin = window.location.origin;
  if (isAdmin) {
    const res = await $fetch<{ url: string }>(`/api/videos/${encodeURIComponent(video.id)}/share-link`);
    return new URL(res.url, origin).toString();
  }
  return `${origin}/watch/${encodeURIComponent(video.id)}`;
}

/**
 * Copies the share link; resolves the toast to show (null when the user copies by hand).
 * `t` is the caller's useI18n().t, so the toast words follow the UI language.
 */
export async function shareVideoLink(
  video: { id: string },
  isAdmin: boolean,
  t: (key: string) => string,
): Promise<{ ok: boolean; message: string | null }> {
  let url: string;
  try {
    url = await videoShareUrl(video, isAdmin);
  } catch (err: any) {
    return { ok: false, message: apiErrorMessage(err, t, 'common.shareLinkFailed') };
  }
  const result = await copyToClipboard(url);
  return { ok: true, message: result === 'copied' ? t('common.shareLinkCopied') : null };
}
