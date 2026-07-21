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

export function buildSponsorBlockArgs(settings: Record<string, string>): string[] {
  const markCategories: string[] = [];
  const removeCategories: string[] = [];

  for (const category of SPONSORBLOCK_CATEGORIES) {
    const action = settings[category] || 'ignore';
    if (action === 'mark') {
      markCategories.push(category);
    } else if (action === 'remove') {
      removeCategories.push(category);
    }
  }

  const args: string[] = [];
  if (markCategories.length > 0) {
    args.push('--sponsorblock-mark', markCategories.join(','));
  }
  if (removeCategories.length > 0) {
    args.push('--sponsorblock-remove', removeCategories.join(','));
  }
  return args;
}
