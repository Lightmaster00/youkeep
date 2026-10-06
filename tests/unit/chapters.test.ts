import { describe, it, expect } from 'vitest';
import { parseChaptersFromInfoData, buildSponsorBlockArgs, buildSponsorBlockMarkArgs, buildSponsorBlockRemoveArgs, SPONSORBLOCK_CATEGORIES } from '../../server/utils/chapters';

describe('parseChaptersFromInfoData', () => {
  it('returns an empty array when infoData has no chapters', () => {
    expect(parseChaptersFromInfoData({})).toEqual([]);
    expect(parseChaptersFromInfoData(null)).toEqual([]);
    expect(parseChaptersFromInfoData({ chapters: null })).toEqual([]);
  });

  it('tags native vs [SponsorBlock] chapters in order and defaults missing fields', () => {
    expect(parseChaptersFromInfoData({
      chapters: [
        { start_time: 0, end_time: 30, title: 'Intro' },
        { start_time: 45.5, title: '[SponsorBlock]: Sponsor' },
        {},
      ],
    })).toEqual([
      { start_time: 0, title: 'Intro', source: 'youtube' },
      { start_time: 45.5, title: '[SponsorBlock]: Sponsor', source: 'sponsorblock' },
      { start_time: 0, title: '', source: 'youtube' },
    ]);
  });
});

describe('buildSponsorBlockArgs', () => {
  it('returns an empty array when every category is ignore', () => {
    expect(buildSponsorBlockArgs({})).toEqual([]);
    expect(buildSponsorBlockArgs(Object.fromEntries(SPONSORBLOCK_CATEGORIES.map(c => [c, 'ignore'])))).toEqual([]);
  });

  it('builds mark and remove flags in SPONSORBLOCK_CATEGORIES order (not settings key order)', () => {
    expect(buildSponsorBlockArgs({ outro: 'mark', intro: 'mark' })).toEqual(['--sponsorblock-mark', 'intro,outro']);
    expect(buildSponsorBlockArgs({ filler: 'remove', interaction: 'remove' })).toEqual(['--sponsorblock-remove', 'interaction,filler']);
    expect(buildSponsorBlockArgs({ sponsor: 'remove', selfpromo: 'mark' })).toEqual(['--sponsorblock-mark', 'selfpromo', '--sponsorblock-remove', 'sponsor']);
  });

  it('mark-only / remove-only builders keep just their own flag', () => {
    expect(buildSponsorBlockMarkArgs({ sponsor: 'mark', filler: 'remove' })).toEqual(['--sponsorblock-mark', 'sponsor']);
    expect(buildSponsorBlockRemoveArgs({ sponsor: 'mark', filler: 'remove' })).toEqual(['--sponsorblock-remove', 'filler']);
    expect(buildSponsorBlockMarkArgs({ sponsor: 'remove' })).toEqual([]);
    expect(buildSponsorBlockRemoveArgs({ sponsor: 'mark' })).toEqual([]);
  });
});
