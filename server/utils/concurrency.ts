export const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 2;

export function parseMaxConcurrentDownloads(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MAX_CONCURRENT_DOWNLOADS;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_CONCURRENT_DOWNLOADS;
  return parsed;
}

export function hasCapacityForMoreDownloads(activeCount: number, maxConcurrent: number): boolean {
  return activeCount < maxConcurrent;
}

export function isValidMaxConcurrentValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}
