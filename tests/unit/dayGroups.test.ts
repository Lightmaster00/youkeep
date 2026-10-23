import { describe, it, expect } from 'vitest';
import { dayBucket, groupByUploadDay, relativeDay } from '../../app/utils/dayGroups';

// Local dates: the headings follow the viewer's calendar.
const now = new Date(2026, 9, 23, 0, 30); // Oct 23, 2026, 00:30 local

describe('dayBucket', () => {
  it('sorts YYYYMMDD dates into Today / Yesterday / This week / Earlier', () => {
    expect(dayBucket('20261023', now)).toBe('today');
    expect(dayBucket('20261022', now)).toBe('yesterday');
    expect(dayBucket('20261021', now)).toBe('week');
    expect(dayBucket('20261017', now)).toBe('week');
    expect(dayBucket('20261016', now)).toBe('earlier');
    expect(dayBucket('20250101', now)).toBe('earlier');
  });

  it('counts a date ahead of the viewer as today and a missing or bad one as earlier', () => {
    expect(dayBucket('20261024', now)).toBe('today');
    expect(dayBucket(null, now)).toBe('earlier');
    expect(dayBucket('2026-10-23', now)).toBe('earlier');
  });
});

describe('groupByUploadDay', () => {
  it('keeps the order and makes one heading per consecutive run', () => {
    const list = ['20261023', '20261023', '20261022', '20261019', '20261001', null].map((d, i) => ({ id: `v${i}`, upload_date: d }));
    const groups = groupByUploadDay(list, now);
    expect(groups.map((g) => [g.label, g.items.map((v) => v.id)])).toEqual([
      ['Today', ['v0', 'v1']],
      ['Yesterday', ['v2']],
      ['This week', ['v3']],
      ['Earlier', ['v4', 'v5']],
    ]);
  });

  it('runs the other way for the oldest first', () => {
    const list = ['20200101', '20261022', '20261023'].map((d) => ({ upload_date: d }));
    expect(groupByUploadDay(list, now).map((g) => g.label)).toEqual(['Earlier', 'Yesterday', 'Today']);
  });
});

describe('relativeDay', () => {
  it('says how long ago in English', () => {
    expect(relativeDay('20261023', now, 'en')).toBe('today');
    expect(relativeDay('20261022', now, 'en')).toBe('yesterday');
    expect(relativeDay('20261020', now, 'en')).toBe('3 days ago');
    expect(relativeDay('20261009', now, 'en')).toBe('2 weeks ago');
    expect(relativeDay('20260601', now, 'en')).toBe('4 months ago');
    expect(relativeDay('20240101', now, 'en')).toBe('2 years ago');
    expect(relativeDay(null, now, 'en')).toBe('');
  });

  it('says it in French for the fr UI language', () => {
    expect(relativeDay('20261023', now, 'fr')).toBe('aujourd’hui');
    expect(relativeDay('20261022', now, 'fr')).toBe('hier');
    expect(relativeDay('20261020', now, 'fr')).toBe('il y a 3 jours');
    expect(relativeDay('20261009', now, 'fr')).toBe('il y a 2 semaines');
    expect(relativeDay('20240101', now, 'fr')).toBe('il y a 2 ans');
  });
});
