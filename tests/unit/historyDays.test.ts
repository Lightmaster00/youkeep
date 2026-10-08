import { describe, it, expect } from 'vitest';
import { groupByDay, historyDayLabel } from '../../app/utils/historyDays';

// Local-time dates, so the test holds in any time zone.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 10, 8, 15);

describe('historyDayLabel', () => {
  it('says Today and Yesterday by calendar day, not by 24-hour windows', () => {
    expect(historyDayLabel(at(2026, 10, 8, 0), NOW)).toBe('Today');
    expect(historyDayLabel(at(2026, 10, 7, 23), NOW)).toBe('Yesterday');
    expect(historyDayLabel(at(2026, 10, 7, 0), NOW)).toBe('Yesterday');
    expect(historyDayLabel(at(2026, 10, 6, 23), NOW)).toBe('Tuesday, October 6');
  });

  it('handles month boundaries and adds the year only for another year', () => {
    expect(historyDayLabel(at(2026, 9, 30), at(2026, 10, 1, 9))).toBe('Yesterday');
    expect(historyDayLabel(at(2025, 12, 31), NOW)).toBe('Wednesday, December 31, 2025');
  });
});

describe('groupByDay', () => {
  it('groups consecutive items of the same day, keeping their order', () => {
    const items = [
      { id: 'a', ts: at(2026, 10, 8, 14) },
      { id: 'b', ts: at(2026, 10, 8, 1) },
      { id: 'c', ts: at(2026, 10, 7, 22) },
      { id: 'd', ts: at(2026, 10, 1) },
      { id: 'e', ts: at(2026, 10, 1, 8) },
    ];
    const days = groupByDay(items, (i) => i.ts, NOW);
    expect(days.map((d) => [d.label, d.items.map((i) => i.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Thursday, October 1', ['d', 'e']],
    ]);
    expect(new Set(days.map((d) => d.key)).size).toBe(3);
    expect(groupByDay([], (i: any) => i.ts, NOW)).toEqual([]);
  });
});
