export const SPONSORBLOCK_CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'filler'] as const;
export type SponsorBlockCategory = typeof SPONSORBLOCK_CATEGORIES[number];
export type SponsorBlockAction = 'ignore' | 'mark' | 'remove';

export interface ParsedChapter {
  start_time: number;
  title: string;
  source: 'youtube' | 'sponsorblock';
}

const SPONSORBLOCK_TITLE_PREFIX = '[SponsorBlock]:';

export function parseChaptersFromInfoData(infoData: any): ParsedChapter[] {
  if (!infoData || !Array.isArray(infoData.chapters)) {
    return [];
  }
  return infoData.chapters.map((chapter: any): ParsedChapter => {
    const title = typeof chapter.title === 'string' ? chapter.title : '';
    return {
      start_time: typeof chapter.start_time === 'number' ? chapter.start_time : 0,
      title,
      source: title.startsWith(SPONSORBLOCK_TITLE_PREFIX) ? 'sponsorblock' : 'youtube',
    };
  });
}

// --sponsorblock-mark only writes chapter markers/metadata and needs no
// re-encoding, so it can run without ffmpeg. --sponsorblock-remove actually
// cuts segments out of the video, which does require ffmpeg.
export function buildSponsorBlockMarkArgs(settings: Record<string, string>): string[] {
  const markCategories = SPONSORBLOCK_CATEGORIES.filter((category) => (settings[category] || 'ignore') === 'mark');
  return markCategories.length > 0 ? ['--sponsorblock-mark', markCategories.join(',')] : [];
}

export function buildSponsorBlockRemoveArgs(settings: Record<string, string>): string[] {
  const removeCategories = SPONSORBLOCK_CATEGORIES.filter((category) => (settings[category] || 'ignore') === 'remove');
  return removeCategories.length > 0 ? ['--sponsorblock-remove', removeCategories.join(',')] : [];
}

export function buildSponsorBlockArgs(settings: Record<string, string>): string[] {
  return [...buildSponsorBlockMarkArgs(settings), ...buildSponsorBlockRemoveArgs(settings)];
}
