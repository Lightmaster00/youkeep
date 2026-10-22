import { describe, it, expect } from 'vitest';
import { VIDEO_SCHEDULE_PRESETS, MUSIC_SCHEDULE_PRESETS, PODCAST_SCHEDULE_PRESETS, presetForSchedule } from '../../app/utils/schedulePresets';

describe('schedule presets', () => {
  it('keep the times used today', () => {
    expect(VIDEO_SCHEDULE_PRESETS).toEqual({ hourly: '0 * * * *', six_hours: '0 */6 * * *', twelve_hours: '0 */12 * * *', daily: '0 3 * * *', weekly: '0 3 * * 0' });
    expect(MUSIC_SCHEDULE_PRESETS.daily).toBe('30 3 * * *');
    expect(MUSIC_SCHEDULE_PRESETS.weekly).toBe('30 3 * * 0');
    expect(PODCAST_SCHEDULE_PRESETS.daily).toBe('0 4 * * *');
    expect(PODCAST_SCHEDULE_PRESETS.weekly).toBe('0 4 * * 0');
  });

  it('finds the preset of a schedule, else custom', () => {
    expect(presetForSchedule(MUSIC_SCHEDULE_PRESETS, '30 3 * * *')).toBe('daily');
    expect(presetForSchedule(MUSIC_SCHEDULE_PRESETS, '0 3 * * *')).toBe('custom');
    expect(presetForSchedule(VIDEO_SCHEDULE_PRESETS, '0 */12 * * *')).toBe('twelve_hours');
  });

  it('offers the default every-6-hours schedules (staggered per type)', () => {
    expect(presetForSchedule(VIDEO_SCHEDULE_PRESETS, '0 */6 * * *')).toBe('six_hours');
    expect(presetForSchedule(MUSIC_SCHEDULE_PRESETS, '30 */6 * * *')).toBe('six_hours');
    expect(presetForSchedule(PODCAST_SCHEDULE_PRESETS, '45 */6 * * *')).toBe('six_hours');
  });
});
