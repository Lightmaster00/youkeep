export type ScheduleKey = 'hourly' | 'six_hours' | 'twelve_hours' | 'daily' | 'weekly';
export type SchedulePresets = Record<ScheduleKey, string>;

// six_hours matches the default schedules in server/utils/autoSync.ts
// (videos on the hour, music at :30, podcasts at :45).
export const VIDEO_SCHEDULE_PRESETS: SchedulePresets = {
  hourly: '0 * * * *', six_hours: '0 */6 * * *', twelve_hours: '0 */12 * * *', daily: '0 3 * * *', weekly: '0 3 * * 0',
};
export const MUSIC_SCHEDULE_PRESETS: SchedulePresets = {
  hourly: '0 * * * *', six_hours: '30 */6 * * *', twelve_hours: '0 */12 * * *', daily: '30 3 * * *', weekly: '30 3 * * 0',
};
export const PODCAST_SCHEDULE_PRESETS: SchedulePresets = {
  hourly: '0 * * * *', six_hours: '45 */6 * * *', twelve_hours: '0 */12 * * *', daily: '0 4 * * *', weekly: '0 4 * * 0',
};

export function presetForSchedule(presets: SchedulePresets, schedule: string): ScheduleKey | 'custom' {
  const hit = (Object.keys(presets) as ScheduleKey[]).find((key) => presets[key] === schedule);
  return hit ?? 'custom';
}
