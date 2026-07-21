import { describe, it, expect } from 'vitest';
import { parseChaptersFromInfoData, buildSponsorBlockArgs, SPONSORBLOCK_CATEGORIES } from '../../server/utils/chapters';

describe('parseChaptersFromInfoData', () => {
  it('returns an empty array when infoData has no chapters', () => {
    expect(parseChaptersFromInfoData({})).toEqual([]);
    expect(parseChaptersFromInfoData(null)).toEqual([]);
    expect(parseChaptersFromInfoData({ chapters: null })).toEqual([]);
  });

  it('parses a native YouTube chapter as source: youtube', () => {
    const result = parseChaptersFromInfoData({
      chapters: [{ start_time: 0, end_time: 30, title: 'Introduction' }]
    });
    expect(result).toEqual([{ start_time: 0, title: 'Introduction', source: 'youtube' }]);
  });

  it('parses a SponsorBlock-marked chapter as source: sponsorblock', () => {
    const result = parseChaptersFromInfoData({
      chapters: [{ start_time: 45.5, end_time: 90, title: '[SponsorBlock]: Sponsor' }]
    });
    expect(result).toEqual([{ start_time: 45.5, title: '[SponsorBlock]: Sponsor', source: 'sponsorblock' }]);
  });

  it('parses a mix of native and SponsorBlock chapters in order', () => {
    const result = parseChaptersFromInfoData({
      chapters: [
        { start_time: 0, title: 'Intro' },
        { start_time: 30, title: '[SponsorBlock]: Intro' },
        { start_time: 60, title: 'Main Content' },
      ]
    });
    expect(result.map(c => c.source)).toEqual(['youtube', 'sponsorblock', 'youtube']);
  });

  it('defaults a missing title to an empty string and missing start_time to 0', () => {
    const result = parseChaptersFromInfoData({ chapters: [{}] });
    expect(result).toEqual([{ start_time: 0, title: '', source: 'youtube' }]);
  });
});

describe('buildSponsorBlockArgs', () => {
  it('returns an empty array when every category is ignore', () => {
    expect(buildSponsorBlockArgs({})).toEqual([]);
    const allIgnore = Object.fromEntries(SPONSORBLOCK_CATEGORIES.map(c => [c, 'ignore']));
    expect(buildSponsorBlockArgs(allIgnore)).toEqual([]);
  });

  it('builds --sponsorblock-mark for categories set to mark', () => {
    const result = buildSponsorBlockArgs({ sponsor: 'mark', intro: 'mark', outro: 'ignore' });
    expect(result).toEqual(['--sponsorblock-mark', 'sponsor,intro']);
  });

  it('builds --sponsorblock-remove for categories set to remove', () => {
    const result = buildSponsorBlockArgs({ filler: 'remove', interaction: 'remove' });
    expect(result).toEqual(['--sponsorblock-remove', 'interaction,filler']);
  });

  it('builds both flags when categories are split between mark and remove', () => {
    const result = buildSponsorBlockArgs({ sponsor: 'remove', selfpromo: 'mark' });
    expect(result).toEqual(['--sponsorblock-mark', 'selfpromo', '--sponsorblock-remove', 'sponsor']);
  });

  it('preserves SPONSORBLOCK_CATEGORIES iteration order within each flag', () => {
    // intro appears before outro in SPONSORBLOCK_CATEGORIES; the joined list must match that order
    // even when the settings object's own key order is reversed.
    const result = buildSponsorBlockArgs({ outro: 'mark', intro: 'mark' });
    expect(result).toEqual(['--sponsorblock-mark', 'intro,outro']);
  });
});
