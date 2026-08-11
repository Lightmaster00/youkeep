import fs from 'fs';

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

export const MIN_FREE_DISK_SPACE_BYTES = 500 * 1024 * 1024; // 500 MB

export async function hasEnoughDiskSpace(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.statfs(dirPath);
    const freeBytes = stats.bavail * stats.bsize;
    return freeBytes >= MIN_FREE_DISK_SPACE_BYTES;
  } catch {
    // If the check itself fails (e.g. platform doesn't support statfs, or the
    // directory doesn't exist yet), don't block downloads over an inability
    // to check — fail open, matching how a disk-space problem would surface
    // naturally anyway (the download itself would fail).
    return true;
  }
}

export const COMBINED_MAX_CONCURRENT_DOWNLOADS = 3;

export function hasCapacityForCombinedDownloads(totalActiveCount: number, maxCombined: number): boolean {
  return totalActiveCount < maxCombined;
}
