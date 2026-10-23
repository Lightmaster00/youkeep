import { isGuestHomeSection } from './homeSectionLabels';

// Client-side guards over the sections of GET /api/home/feed, applied before
// the home renders them. The server already builds them this way; the page
// keeps the rules even if a cached or older response says otherwise:
// - a guest only gets the public rows (no personal ones);
// - a video row never holds a Short, and the Shorts shelf only Shorts;
// - a video shown as the hero is not repeated in a row, and one the viewer
//   just hid disappears;
// - a row left with nothing to show is omitted.

const VIDEO_ROW_IDS = new Set(['continue', 'subscriptions', 'forYou', 'popular', 'becauseYouWatched']);

export interface HomeSectionLike {
  id: string;
  title?: string;
  videos?: any[];
  groups?: { category: string; title?: string; videos: any[] }[];
  playlists?: any[];
  channels?: any[];
  tracks?: any[];
  episodes?: any[];
  [key: string]: unknown;
}

const isShort = (v: any) => !!v?.is_short;

export function prepareHomeSections<T extends HomeSectionLike>(
  sections: readonly T[] | null | undefined,
  opts: { guest: boolean; heroId?: string | null; hidden?: ReadonlySet<string> },
): T[] {
  const out: T[] = [];
  for (const section of sections ?? []) {
    if (!section || typeof section.id !== 'string') continue;
    if (opts.guest && !isGuestHomeSection(section.id)) continue;
    const keep = (v: any) => v && v.id !== opts.heroId && !opts.hidden?.has(v.id);
    if (section.id === 'shorts') {
      const videos = (section.videos ?? []).filter((v) => keep(v) && isShort(v));
      if (videos.length > 0) out.push({ ...section, videos });
    } else if (section.id === 'byCategory') {
      const groups = (section.groups ?? [])
        .map((g) => ({ ...g, videos: (g.videos ?? []).filter((v) => keep(v) && !isShort(v)) }))
        .filter((g) => g.videos.length > 0);
      if (groups.length > 0) out.push({ ...section, groups });
    } else if (VIDEO_ROW_IDS.has(section.id) || Array.isArray(section.videos)) {
      const videos = (section.videos ?? []).filter((v) => keep(v) && !isShort(v));
      if (videos.length > 0) out.push({ ...section, videos });
    } else {
      const list = section.playlists ?? section.channels ?? section.tracks ?? section.episodes;
      if (Array.isArray(list) && list.length > 0) out.push(section);
    }
  }
  return out;
}

/** "Resume from 4:05": the position of a Continue watching card. */
export function formatResumeAt(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
