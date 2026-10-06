export type ScheduleKey = 'hourly' | 'twelve_hours' | 'daily' | 'weekly';
export type SchedulePresets = Record<ScheduleKey, string>;

export const VIDEO_SCHEDULE_PRESETS: SchedulePresets = {
  hourly: '0 * * * *', twelve_hours: '0 */12 * * *', daily: '0 3 * * *', weekly: '0 3 * * 0',
};
export const MUSIC_SCHEDULE_PRESETS: SchedulePresets = {
  hourly: '0 * * * *', twelve_hours: '0 */12 * * *', daily: '30 3 * * *', weekly: '30 3 * * 0',
};
// 4:00 AM matches the podcast_sync_cron_schedule default seeded in server/utils/db.ts.
export const PODCAST_SCHEDULE_PRESETS: SchedulePresets = {
  hourly: '0 * * * *', twelve_hours: '0 */12 * * *', daily: '0 4 * * *', weekly: '0 4 * * 0',
};

export function presetForSchedule(presets: SchedulePresets, schedule: string): ScheduleKey | 'custom' {
  const hit = (Object.keys(presets) as ScheduleKey[]).find((key) => presets[key] === schedule);
  return hit ?? 'custom';
}
