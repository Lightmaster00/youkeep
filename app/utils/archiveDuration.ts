// A total archived duration for the stats panels: minutes under an hour
// ("6 min", not a rounded-up "1h"), then hours and minutes ("2h 05m"), then
// whole hours past 100 h.
export function formatArchiveDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total === 0) return '0 min';
  if (total < 60) return '< 1 min';
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 100) return `${hours.toLocaleString('en-US')}h`;
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}
